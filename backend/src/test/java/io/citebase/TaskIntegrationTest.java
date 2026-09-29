package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = {"citebase.worker-enabled=false", "MODEL_MODE=mock"})
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class TaskIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
          DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
              .asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired org.springframework.test.web.servlet.MockMvc mvc;
  @Autowired JdbcTemplate db;
  @Autowired DocumentService docs;
  @Autowired TaskRepository tasks;
  @Autowired IndexWorker index;
  @Autowired AuthService auth;
  @MockitoSpyBean ModelGateway model;
  String alice, bob, kb;

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    alice = auth.login("alice", "Alice-demo-123!").get("userId").toString();
    bob = auth.login("bob", "Bob-demo-123!").get("userId").toString();
    kb = UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,'tasks')", kb, alice);
  }

  @AfterEach
  void reset() {
    org.mockito.Mockito.reset(model);
  }

  String upload(String name, String content) {
    var d = docs.upload(alice, kb, null, name, content.getBytes(StandardCharsets.UTF_8));
    return db.queryForObject(
        "select id from index_task where document_id=?", String.class, d.get("id"));
  }

  TaskLease claim(String worker) {
    return tasks.claim(worker, Set.of(TaskKind.INDEX)).orElseThrow();
  }

  void expire(String id) {
    db.update(
        "update work_task set lease_until=clock_timestamp()-interval '1 second' where id=?", id);
  }

  @Test
  void concurrentClaimsDistinctAndStartupDoesNotSteal() throws Exception {
    upload("one.md", "one");
    upload("two.md", "two");
    var start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      var a =
          pool.submit(
              () -> {
                start.await();
                return claim("worker-a");
              });
      var b =
          pool.submit(
              () -> {
                start.await();
                return claim("worker-b");
              });
      start.countDown();
      var first = a.get();
      var second = b.get();
      assertNotEquals(first.taskId(), second.taskId());
      index.recover();
      assertTrue(tasks.claim("new-process", Set.of(TaskKind.INDEX)).isEmpty());
      assertTrue(tasks.heartbeat(first));
      assertTrue(tasks.heartbeat(second));
    }
  }

  @Test
  void expiredTokenCannotHeartbeatCheckpointCallOrPublish() {
    String id = upload("fence.md", "evidence");
    var old = claim("old");
    var call = tasks.beginExternalCall(old, "embed-1", "embedding", "public-hash");
    expire(id);
    var next = claim("next");
    assertTrue(next.fencingToken() > old.fencingToken());
    assertFalse(tasks.heartbeat(old));
    assertThrows(TaskSignal.class, () -> tasks.checkpoint(old, "p", Map.of("bad", true)));
    assertThrows(
        TaskSignal.class,
        () -> tasks.completeExternalCall(old, call, Map.of("bad", true), Map.of("tokens", 2)));
    assertThrows(TaskSignal.class, () -> tasks.succeed(old, new TaskResult(Map.of())));
    assertEquals(1, tasks.unknownCalls(next).size());
    assertEquals("RUNNING", tasks.get(alice, id).get("status"));
    tasks.checkpoint(next, "p", Map.of("good", true));
    assertEquals(true, tasks.checkpoint(next, "p", Map.class).orElseThrow().get("good"));
  }

  @Test
  void cancelAndRetryAreAtomicDomainTransitionsAndAcl() {
    String id = upload("cancel.md", "evidence");
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> tasks.cancel(bob, id));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> tasks.retry(bob, id));
    assertEquals("CANCELLED", tasks.cancel(alice, id).get("status"));
    assertEquals(
        "CANCELLED",
        db.queryForObject("select status from index_task where id=?", String.class, id));
    assertTrue(tasks.claim("worker", Set.of(TaskKind.INDEX)).isEmpty());
    assertEquals("QUEUED", tasks.retry(alice, id).get("status"));
    assertEquals(
        "PENDING", db.queryForObject("select status from index_task where id=?", String.class, id));
    assertEquals(1, tasks.get(alice, id).get("retryGeneration"));
  }

  @Test
  void cancelledLiveCallRetainsOnlyUsageAndRejectsCheckpoint() {
    String id = upload("live.md", "secret evidence");
    var l = claim("worker");
    var call = tasks.beginExternalCall(l, "embed", "embedding", "hash");
    tasks.cancel(alice, id);
    tasks.completeExternalCall(
        l, call, Map.of("text", "secret evidence"), Map.of("inputTokens", 17));
    var saved = db.queryForMap("select response,usage::text from work_call where task_id=?", id);
    assertNull(saved.get("response"));
    assertTrue(saved.get("usage").toString().contains("17"));
    assertThrows(TaskSignal.class, () -> tasks.checkpoint(l, "late", Map.of("text", "secret")));
    tasks.fail(l, new TaskFailure("CANCELLED", "取消", false, false));
    assertEquals("CANCELLED", tasks.get(alice, id).get("status"));
    assertEquals(0, db.queryForObject("select count(*) from chunk", Integer.class));
  }

  @Test
  void deferDoesNotSpendAttemptButCrashAfterResumeDoes() {
    String id = upload("defer.md", "evidence");
    var one = claim("one");
    tasks.defer(one, Duration.ZERO);
    var two = claim("two");
    assertEquals(one.attempt(), two.attempt());
    assertTrue(two.fencingToken() > one.fencingToken());
    expire(id);
    var three = claim("three");
    assertEquals(two.attempt() + 1, three.attempt());
  }

  @Test
  void expiredExhaustedClaimCanOnlyFinalizeWithoutModel() {
    String id = upload("cap.md", "evidence");
    db.update(
        "update work_task set"
            + " attempts=max_attempts,status='RUNNING',lease_owner='dead',lease_until=clock_timestamp()-interval"
            + " '1 second' where id=?",
        id);
    org.mockito.Mockito.clearInvocations(model);
    assertTrue(index.processOne());
    assertEquals("FAILED", tasks.get(alice, id).get("status"));
    assertEquals(
        "FAILED", db.queryForObject("select status from index_task where id=?", String.class, id));
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .embed(org.mockito.ArgumentMatchers.anyString());
    assertFalse(index.processOne());
  }

  @Test
  void partialEmbeddingStageSurvivesFailureAndOnlyMissingPartRecomputed() {
    String id = upload("stages.md", "stable first\n\nflaky second");
    org.mockito.Mockito.doThrow(new RuntimeException("temporary failure"))
        .doCallRealMethod()
        .when(model)
        .embed("flaky second");
    assertTrue(index.processOne());
    assertEquals("RETRY_WAIT", tasks.get(alice, id).get("status"));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from index_chunk_stage where task_id=?", Integer.class, id));
    db.update("update work_task set available_at=clock_timestamp() where id=?", id);
    assertTrue(index.processOne());
    assertEquals("SUCCEEDED", tasks.get(alice, id).get("status"));
    org.mockito.Mockito.verify(model, org.mockito.Mockito.times(1)).embed("stable first");
    org.mockito.Mockito.verify(model, org.mockito.Mockito.times(2)).embed("flaky second");
    assertEquals(2, db.queryForObject("select count(*) from chunk", Integer.class));
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from work_call where task_id=? and status='UNKNOWN'",
            Integer.class,
            id));
  }

  @Test
  void configurationDriftFailsBeforeProviderCall() {
    String id = upload("config.md", "evidence");
    org.mockito.Mockito.doReturn("changed-model").when(model).embeddingModel();
    assertTrue(index.processOne());
    assertEquals("CONFIG_CHANGED", tasks.get(alice, id).get("errorCode"));
    assertEquals(
        0, db.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id));
    assertEquals(0, db.queryForObject("select count(*) from chunk", Integer.class));
  }

  @Test
  void deleteRemovesStageAuditAndRejectsLateUsage() {
    String id = upload("delete.md", "private");
    var lease = claim("worker");
    var call = tasks.beginExternalCall(lease, "embed", "embedding", "hash");
    String doc =
        db.queryForObject("select document_id from index_task where id=?", String.class, id);
    tasks.checkpoint(lease, "p", Map.of("body", "private"));
    docs.delete(alice, doc);
    assertThrows(
        TaskSignal.class,
        () ->
            tasks.completeExternalCall(lease, call, Map.of("private", true), Map.of("tokens", 9)));
    assertEquals(
        0, db.queryForObject("select count(*) from work_task where id=?", Integer.class, id));
    assertEquals(
        0, db.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from work_checkpoint where task_id=?", Integer.class, id));
  }

  @Test
  void knownPaymentFailureDoesNotRetryOrClaimUnknownOutcome() {
    String id = upload("payment.md", "billing evidence");
    org.mockito.Mockito.doThrow(new SpringAiGateway.ModelFailure("PROVIDER_PAYMENT_REQUIRED", null))
        .when(model)
        .embedWithUsage("billing evidence");
    assertTrue(index.processOne());
    assertEquals("FAILED", tasks.get(alice, id).get("status"));
    assertEquals("PROVIDER_PAYMENT_REQUIRED", tasks.get(alice, id).get("errorCode"));
    assertEquals(
        "RETURNED",
        db.queryForObject("select status from work_call where task_id=?", String.class, id));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from work_call where task_id=? and status='UNKNOWN'",
            Integer.class,
            id));
    assertFalse(index.processOne());
  }

  @Test
  void malformedEmbeddingRetainsActualUsageButCannotPublish() {
    String id = upload("bad.md", "bad vector");
    org.mockito.Mockito.doReturn(
            new EmbeddingResult(new float[] {Float.NaN}, Map.of("inputTokens", 7)))
        .when(model)
        .embedWithUsage("bad vector");
    assertTrue(index.processOne());
    assertEquals("FAILED", tasks.get(alice, id).get("status"));
    assertEquals("PROVIDER_INVALID_RESPONSE", tasks.get(alice, id).get("errorCode"));
    var call = db.queryForMap("select usage::text,response from work_call where task_id=?", id);
    assertTrue(call.get("usage").toString().contains("7"));
    assertNull(call.get("response"));
    assertEquals(0, db.queryForObject("select count(*) from chunk", Integer.class));
  }

  @Test
  void sourceProfileDriftFailsBeforeEmbedding() {
    String id = upload("profile.md", "profile evidence");
    db.update(
        "update document_version set chunk_size=800 where id=(select version_id from index_task"
            + " where id=?)",
        id);
    assertTrue(index.processOne());
    assertEquals("SOURCE_CHANGED", tasks.get(alice, id).get("errorCode"));
    assertEquals(
        0, db.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id));
  }

  @Test
  void leaseExpiryDuringPublicationRollsBackAllWrites() {
    String id = upload("rollback.md", "evidence");
    var l = claim("worker");
    db.update(
        "update work_task set lease_until=clock_timestamp()+interval '100 milliseconds' where id=?",
        id);
    assertThrows(
        TaskSignal.class,
        () ->
            tasks.guarded(
                l,
                TaskLock.EXCLUSIVE_SOURCE,
                sql -> {
                  sql.update(
                      "update document set name='should rollback' where id=(select document_id from"
                          + " index_task where id=?)",
                      id);
                  sql.queryForObject("select pg_sleep(0.2)", Object.class);
                  return null;
                }));
    assertEquals(
        "rollback.md",
        db.queryForObject(
            "select d.name from document d join index_task t on t.document_id=d.id where t.id=?",
            String.class,
            id));
  }

  @Test
  void taskListFiltersInSqlAndRejectsUnknownKinds() throws Exception {
    String id = upload("filter.md", "evidence");
    assertEquals(1, tasks.list(alice, kb, TaskKind.INDEX).size());
    assertTrue(tasks.list(alice, kb, TaskKind.AGENT).isEmpty());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> tasks.get(bob, id));
    String token = auth.login("alice", "Alice-demo-123!").get("token").toString();
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/tasks")
                .param("kind", "SHELL")
                .header("Authorization", "Bearer " + token))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status()
                .isBadRequest());
  }

  @Test
  void forgedLeaseIdentityCannotCrossKnowledgeBaseBoundary() {
    String id = upload("identity.md", "evidence");
    var real = claim("worker");
    var forged =
        new TaskLease(
            id,
            real.kind(),
            bob,
            real.kbId(),
            id,
            real.workerId(),
            real.fencingToken(),
            real.attempt(),
            true,
            real.payload());
    assertThrows(TaskSignal.class, () -> tasks.checkpoint(forged, "p", Map.of("stolen", true)));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from work_checkpoint where task_id=?", Integer.class, id));
    tasks.assertActive(real);
  }
}
