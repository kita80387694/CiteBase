package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@SpringBootTest(properties = {"citebase.worker-enabled=false", "MODEL_MODE=mock"})
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class AsyncEvaluationIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
              org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("eval_tasks")
          .withUsername("citebase")
          .withPassword("test");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired JdbcTemplate db;
  @Autowired AuthService auth;
  @Autowired DocumentService documents;
  @Autowired IndexWorker index;
  @Autowired TaskWorker worker;
  @Autowired TaskRepository tasks;
  @Autowired EvaluationService evaluations;
  @Autowired RetrievalService retrieval;
  @Autowired QuestionService json;
  @Autowired EvaluationScoringService scores;
  @Autowired MockMvc mvc;
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean ModelGateway model;
  String user, bob, token, kb, doc;
  final String original = "alpha port is 9081.";

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    var a = auth.login("alice", "Alice-demo-123!");
    user = a.get("userId").toString();
    token = a.get("token").toString();
    bob = auth.login("bob", "Bob-demo-123!").get("userId").toString();
    kb = UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,'async')", kb, user);
    doc =
        documents
            .upload(user, kb, null, "guide.md", original.getBytes(StandardCharsets.UTF_8))
            .get("id")
            .toString();
    index.processOne();
    clearInvocations(model);
  }

  @AfterEach
  void clear() {
    reset(model);
  }

  EvaluationService.Request request(String key) {
    return new EvaluationService.Request(
        kb,
        "async",
        new EvaluationService.Dataset(
            "v1",
            List.of(
                new EvaluationService.Case(
                    "port",
                    "alpha port",
                    true,
                    "9081",
                    List.of(new EvaluationMetrics.Label("guide.md", 1, 1, original))))),
        5,
        null,
        key);
  }

  Map<?, ?> view(String id) {
    return (Map<?, ?>) evaluations.get(user, id);
  }

  @Test
  void retrievalCostConfigurationSurvivesJsonbNumericRoundTripForAllOptIns() {
    var options =
        List.of(
            new RetrievalOptions(5, 1.0, false, "uuid", "candidate-pressure-v1", null, null),
            new RetrievalOptions(5, 1.0, false, "uuid", null, true, null),
            new RetrievalOptions(5, 1.0, false, "uuid", null, null, true));
    for (int n = 0; n < options.size(); n++) {
      var base = request("cost-roundtrip-" + n);
      var request =
          new EvaluationService.Request(
              kb, base.name(), base.dataset(), 5, options.get(n), base.idempotencyKey());
      String id = evaluations.create(user, request).get("id").toString();
      var persisted = (Map<?, ?>) ((Map<?, ?>) view(id).get("config")).get("retrievalCost");
      var live = retrieval.costConfiguration(options.get(n));
      var liveTtl = ((Map<?, ?>) live.get("cache")).get("ttlSeconds");
      var storedTtl = ((Map<?, ?>) persisted.get("cache")).get("ttlSeconds");
      assertInstanceOf(Long.class, liveTtl);
      assertInstanceOf(Integer.class, storedTtl);
      assertEquals(((Number) liveTtl).longValue(), ((Number) storedTtl).longValue());
      assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
      assertEquals("SUCCEEDED", view(id).get("status"));
      var rows = (List<?>) view(id).get("results");
      assertEquals(2, rows.size());
      assertEquals(
          Set.of("vector", "hybrid"),
          rows.stream()
              .map(row -> ((Map<?, ?>) row).get("mode"))
              .collect(java.util.stream.Collectors.toSet()));
      assertEquals(
          2,
          db.queryForObject(
              "select count(*) from evaluation_item where evaluation_id=? and status='SUCCEEDED'",
              Integer.class,
              id));
    }
  }

  @Test
  void changedRetrievalCostConfigurationStillFailsBeforeProviderCalls() {
    var base = request("cost-real-drift");
    var options = new RetrievalOptions(5, 1.0, false, "uuid", null, null, true);
    String id =
        evaluations
            .create(
                user,
                new EvaluationService.Request(
                    kb, base.name(), base.dataset(), 5, options, base.idempotencyKey()))
            .get("id")
            .toString();
    db.update(
        "update evaluation_run set payload=jsonb_set(payload,"
            + "'{config,retrievalCost,cache,ttlSeconds}',to_jsonb((payload #>>"
            + " '{config,retrievalCost,cache,ttlSeconds}')::bigint + 1)) where id=?",
        id);
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    assertEquals("FAILED", view(id).get("status"));
    assertEquals("CONFIG_CHANGED", view(id).get("error"));
    // Terminal rejection retains each planned item as an explicit failure, not a missing sample.
    assertEquals(2, ((List<?>) view(id).get("results")).size());
    assertEquals(2, db.queryForObject(
        "select count(*) from evaluation_item where evaluation_id=? and status='FAILED'"
            + " and error_code='CONFIG_CHANGED' and attempts=0", Integer.class, id));
    assertEquals(0, db.queryForObject(
        "select count(*) from evaluation_attempt where evaluation_id=?", Integer.class, id));
    verify(model, never()).embedWithUsage(anyString());
    verify(model, never()).generate(anyString(), anyList());
  }

  @Test
  void networkFaultAdapterRemainsMockButRecordsExternalIntent() {
    var config = new LinkedHashMap<String, Object>(model.configuration());
    config.put("externalNetwork", true);
    doReturn(config).when(model).configuration();
    String id = evaluations.create(user, request("network-audit")).get("id").toString();
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    assertEquals("SUCCEEDED", view(id).get("status"));
    assertEquals("mock", model.mode());
    for (String provider : List.of("embedding", "generation")) {
      assertEquals(
          2,
          db.queryForObject(
              "select count(*) from work_call where task_id=? and provider=? and status='RETURNED'",
              Integer.class,
              id,
              provider));
    }
  }

  @Test
  void create202IsDurableAndIdempotentWithoutProviderWork() throws Exception {
    var request = request("once");
    var result =
        mvc.perform(
                post("/api/evaluations")
                    .header("Authorization", "Bearer " + token)
                    .contentType("application/json")
                    .content(json.encode(request)))
            .andExpect(status().isAccepted())
            .andReturn();
    var created = (Map<?, ?>) json.decode(result.getResponse().getContentAsString());
    String id = created.get("id").toString();
    assertEquals(id, created.get("taskId"));
    assertEquals("QUEUED", created.get("status"));
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from evaluation_item where evaluation_id=?", Integer.class, id));
    verify(model, never()).generate(anyString(), anyList());
    assertEquals(id, evaluations.create(user, request).get("id"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () ->
            evaluations.create(
                user,
                new EvaluationService.Request(kb, "changed", request.dataset(), 5, null, "once")));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> evaluations.get(bob, id));
  }

  @Test
  void snapshotUsesOldVersionAfterPromotionAndCitationRequiresMembership() {
    String old = documents.view(doc).get("activeVersionId").toString();
    String id = evaluations.create(user, request("snapshot")).get("id").toString();
    documents.upload(
        user, kb, doc, "guide.md", "alpha port is 9999.".getBytes(StandardCharsets.UTF_8));
    assertTrue(index.processOne());
    assertNotEquals(old, documents.view(doc).get("activeVersionId"));
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    var result = view(id);
    assertEquals("SUCCEEDED", result.get("status"));
    var row = (Map<?, ?>) ((List<?>) result.get("results")).getFirst();
    var evidence = (Map<?, ?>) ((List<?>) row.get("evidence")).getFirst();
    assertEquals(old, evidence.get("versionId"));
    assertEquals(
        old, retrieval.evaluationCitation(user, id, evidence.get("id").toString()).versionId());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> retrieval.evaluationCitation(bob, id, evidence.get("id").toString()));
    var current = retrieval.retrieve(user, kb, "alpha port", "vector", 5).getFirst();
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> retrieval.evaluationCitation(user, id, current.id()));
  }

  @Test
  void queuedCancelAndRetryProjectImmediatelyWithoutWorker() {
    String id = evaluations.create(user, request("cancel")).get("id").toString();
    tasks.cancel(user, id);
    assertEquals("CANCELLED", view(id).get("status"));
    assertTrue((Boolean) view(id).get("partial"));
    tasks.retry(user, id);
    assertEquals("QUEUED", view(id).get("status"));
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    assertEquals("SUCCEEDED", view(id).get("status"));
  }

  @Test
  void crashAfterCheckpointResumesOnlyUnfinishedItemsAndKeepsUnknownAttempt() throws Exception {
    String id = evaluations.create(user, request("crash")).get("id").toString();
    var lease = tasks.claim("crashed-worker", Set.of(TaskKind.EVALUATION)).orElseThrow();
    var count = new AtomicInteger();
    doAnswer(
            inv -> {
              if (count.incrementAndGet() == 2)
                throw new AssertionError("simulated process loss before checkpoint");
              return inv.callRealMethod();
            })
        .when(model)
        .generate(anyString(), anyList());
    TaskContext context = new TaskContext(lease, tasks);
    TaskContext.bind(context);
    try {
      assertThrows(AssertionError.class, () -> evaluations.execute(context));
    } finally {
      TaskContext.clear();
    }
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from evaluation_item where evaluation_id=? and status='SUCCEEDED'",
            Integer.class,
            id));
    String first =
        db.queryForObject(
            "select result::text from evaluation_item where evaluation_id=? and status='SUCCEEDED'",
            String.class,
            id);
    reset(model);
    db.update(
        "update work_task set lease_until=clock_timestamp()-interval '1 second' where id=?", id);
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    assertEquals("SUCCEEDED", view(id).get("status"));
    assertEquals(
        first,
        db.queryForObject(
            "select result::text from evaluation_item where evaluation_id=? and mode='vector'",
            String.class,
            id));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from evaluation_attempt where evaluation_id=? and status='UNKNOWN'",
            Integer.class,
            id));
    verify(model, times(1)).generate(anyString(), anyList());
    assertThrows(
        TaskSignal.class,
        () ->
            tasks.guarded(
                lease,
                TaskLock.SHARED_SOURCE,
                sql -> {
                  sql.update(
                      "update evaluation_item set error_code='stale' where evaluation_id=?", id);
                  return null;
                }));
  }

  @Test
  void cancellationDuringProviderPreservesPartialAndNoNextStep() throws Exception {
    String id = evaluations.create(user, request("inflight")).get("id").toString();
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    doAnswer(
            inv -> {
              entered.countDown();
              assertTrue(release.await(10, TimeUnit.SECONDS));
              return inv.callRealMethod();
            })
        .when(model)
        .generate(anyString(), anyList());
    try (var pool = Executors.newSingleThreadExecutor()) {
      var work = pool.submit(() -> worker.processOne(Set.of(TaskKind.EVALUATION)));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      try {
        tasks.cancel(user, id);
      } finally {
        release.countDown();
      }
      work.get(5, TimeUnit.SECONDS);
    }
    assertEquals("CANCELLED", view(id).get("status"));
    assertEquals(0, ((List<?>) view(id).get("results")).size());
    verify(model, times(1)).generate(anyString(), anyList());
  }

  @Test
  void nonterminalScoreRejectedAndCompletedResultDigestStored() {
    String id = evaluations.create(user, request("score")).get("id").toString();
    var score =
        new EvaluationScoringService.Request(
            "port", "vector", true, "human", "reviewed fixture", "test-rule", true, List.of());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> scores.score(user, id, score));
    worker.processOne(Set.of(TaskKind.EVALUATION));
    scores.score(user, id, score);
    assertTrue(
        db.queryForObject(
                "select result_digest from evaluation_score where evaluation_id=?",
                String.class,
                id)
            .matches("[a-f0-9]{64}"));
  }

  @Test
  void transientErrorsRetryWithAttemptsButPaymentErrorDoesNot() {
    String id = evaluations.create(user, request("rate")).get("id").toString();
    doReturn(new Generation(Citations.ABSTENTION, null, null, "PROVIDER_RATE_LIMIT"))
        .when(model)
        .generate(anyString(), anyList());
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    db.update("update evaluation_item set available_at=now() where evaluation_id=?", id);
    db.update("update work_task set available_at=now() where id=?", id);
    assertTrue(worker.processOne(Set.of(TaskKind.EVALUATION)));
    assertEquals(
        4,
        db.queryForObject(
            "select count(*) from evaluation_attempt where evaluation_id=?", Integer.class, id));
    assertEquals(2, ((List<?>) view(id).get("results")).size());
    reset(model);
    String paid = evaluations.create(user, request("payment")).get("id").toString();
    doReturn(new Generation(Citations.ABSTENTION, null, null, "PROVIDER_PAYMENT_REQUIRED"))
        .when(model)
        .generate(anyString(), anyList());
    worker.processOne(Set.of(TaskKind.EVALUATION));
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from evaluation_attempt where evaluation_id=?", Integer.class, paid));
    assertEquals("SUCCEEDED", view(paid).get("status"));
  }
}
