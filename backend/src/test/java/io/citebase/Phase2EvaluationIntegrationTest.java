package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
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
class Phase2EvaluationIntegrationTest {
  @Test
  void abstentionMetricsExcludeProviderAndCitationErrorsButPreserveLegacy() {
    var unanswerable =
        new EvaluationService.Dataset(
            "abstention-v2",
            List.of(
                new EvaluationService.Case(
                    "unknown", "alpha unknown fact", false, null, List.of())));
    for (Generation generation :
        List.of(
            new Generation(Citations.ABSTENTION, null, null, "provider timeout"),
            new Generation("fabricated [999]", 1L, 2L, null))) {
      org.mockito.Mockito.doReturn(generation)
          .when(model)
          .generate(
              org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
      var run = evaluations.run(alice, request(unanswerable));
      for (var value : (List<?>) run.get("results")) {
        var row = (Map<?, ?>) value;
        assertEquals(true, row.get("abstained"));
        assertNotNull(row.get("error"));
        assertEquals(false, row.get("abstentionCorrect"));
      }
      assertEquals(EvaluationService.METRIC_DEFINITION_VERSION, run.get("metricDefinitionVersion"));
    }
    org.mockito.Mockito.doReturn(new Generation(Citations.ABSTENTION, 1L, 2L, null))
        .when(model)
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    var normal = evaluations.run(alice, request(unanswerable));
    for (var value : (List<?>) normal.get("results"))
      assertEquals(true, ((Map<?, ?>) value).get("abstentionCorrect"));
    var answerable = evaluations.run(alice, request(dataset(label())));
    for (var value : (List<?>) answerable.get("results"))
      assertNull(((Map<?, ?>) value).get("abstentionCorrect"));
    String id = (String) normal.get("id");
    db.update("update evaluation_run set payload=payload-'metricDefinitionVersion' where id=?", id);
    String before =
        db.queryForObject("select payload::text from evaluation_run where id=?", String.class, id);
    var legacy = (Map<?, ?>) evaluations.get(alice, id);
    assertEquals("legacy-unversioned", legacy.get("metricDefinitionVersion"));
    assertNotNull(legacy.get("metricDefinitionNote"));
    assertEquals(
        before,
        db.queryForObject("select payload::text from evaluation_run where id=?", String.class, id));
  }

  @Test
  void nulImportRejectedBeforePersistence() throws Exception {
    String body =
        json.encode(request(dataset(label())))
            .replace("\"name\":\"phase2\"", "\"name\":\"bad\\u0000name\"");
    mvc.perform(
            post("/api/evaluations")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("字段不得包含NUL字符：name"));
    assertEquals(0, db.queryForObject("select count(*) from evaluation_run", Integer.class));
  }

  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
              org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("citebase")
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
  @Autowired IndexWorker worker;
  @Autowired EvaluationService evaluations;
  @Autowired EvaluationScoringService scoring;
  @Autowired EvaluationLabels labels;
  @Autowired QuestionService json;
  @Autowired MockMvc mvc;
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean ModelGateway model;
  String alice, bob, kb, bobKb, aliceToken, bobToken, hash;
  String text = "alpha policy states rollback isolation.\n\nbeta policy states tenant access.";

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    var a = auth.login("alice", "Alice-demo-123!");
    var b = auth.login("bob", "Bob-demo-123!");
    alice = (String) a.get("userId");
    bob = (String) b.get("userId");
    aliceToken = (String) a.get("token");
    bobToken = (String) b.get("token");
    kb = UUID.randomUUID().toString();
    bobKb = UUID.randomUUID().toString();
    db.update(
        "insert into knowledge_base(id,user_id,name) values(?,?,'alice'),(?,?,'bob')",
        kb,
        alice,
        bobKb,
        bob);
    documents.upload(alice, kb, null, "guide.md", text.getBytes(StandardCharsets.UTF_8));
    documents.upload(
        bob, bobKb, null, "secret.md", "Bob only secret".getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    worker.processOne();
    hash = AuthService.hash(text.getBytes(StandardCharsets.UTF_8));
    org.mockito.Mockito.clearInvocations(model);
  }

  @AfterEach
  void reset() {
    org.mockito.Mockito.reset(model);
  }

  EvaluationService.Dataset dataset(EvaluationMetrics.Label... annotations) {
    return new EvaluationService.Dataset(
        "phase2-v1",
        List.of(
            new EvaluationService.Case(
                "c1",
                "alpha policy",
                true,
                "rollback",
                List.of(annotations),
                "cross_evidence",
                "test",
                "policies",
                "isolation")),
        42,
        "test");
  }

  EvaluationService.Request request(EvaluationService.Dataset dataset) {
    return new EvaluationService.Request(kb, "phase2", dataset, 5);
  }

  EvaluationMetrics.Label label() {
    return new EvaluationMetrics.Label("guide.md", 1, 1, "alpha policy");
  }

  @Test
  void validLabelsResolveFromSourceAndPersistMetadata() {
    var run = evaluations.run(alice, request(dataset(label())));
    assertEquals("COMPLETED", run.get("status"));
    var saved = (Map<?, ?>) evaluations.get(alice, (String) run.get("id"));
    var row = (Map<?, ?>) ((List<?>) saved.get("results")).getFirst();
    var annotation = (Map<?, ?>) ((List<?>) row.get("expectedEvidence")).getFirst();
    assertEquals(hash, annotation.get("sourceHash"));
    assertEquals(0, annotation.get("startOffset"));
    assertEquals(12, annotation.get("endOffset"));
    assertEquals("test", row.get("split"));
    assertEquals(true, row.get("allEvidenceHit"));
    assertNotNull(saved.get("breakdowns"));
    assertNull(row.get("answerCorrect"));
    assertNull(row.get("manualScore"));
  }

  @Test
  void forgedPositionsHashesNamesAndTenantLabelsRejectedBeforeModel() {
    var bad =
        List.of(
            new EvaluationMetrics.Label(
                "guide.md", 1, 1, "alpha policy", "0".repeat(64), 0, 12, null),
            new EvaluationMetrics.Label("guide.md", 1, 1, "alpha policy", hash, 1, 13, null),
            new EvaluationMetrics.Label("guide.md", 2, 1, "alpha policy"),
            new EvaluationMetrics.Label("guide.md", 1, 2, "alpha policy"),
            new EvaluationMetrics.Label("secret.md", 1, 1, "Bob only secret"),
            new EvaluationMetrics.Label("guide.md", 1, 1, "invented"));
    for (var l : bad)
      assertThrows(
          IllegalArgumentException.class, () -> evaluations.run(alice, request(dataset(l))));
    assertEquals(0, db.queryForObject("select count(*) from evaluation_run", Integer.class));
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .embed(org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void labelsCanSpanCandidateChunksAndAmbiguousLegacyLabelsFail() {
    String longText = "A".repeat(850) + "UNIQUE" + "B".repeat(850);
    documents.upload(alice, kb, null, "long.txt", longText.getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    String quote = longText.substring(500, 1300);
    var resolved =
        labels.resolve(
            alice,
            kb,
            dataset(new EvaluationMetrics.Label("long.txt", 1, 1, quote, null, 500, 1300, "g")));
    assertEquals(500, resolved.questions().getFirst().evidence().getFirst().startOffset());
    documents.upload(
        alice, kb, null, "repeat.txt", "repeat word repeat word".getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    assertThrows(
        IllegalArgumentException.class,
        () ->
            labels.resolve(
                alice, kb, dataset(new EvaluationMetrics.Label("repeat.txt", 1, 1, "repeat"))));
  }

  @Test
  void manualScoresAppendAuditWithoutMutatingAutomaticPayloadAndEnforceAcl() throws Exception {
    var run = evaluations.run(alice, request(dataset(label())));
    String id = (String) run.get("id"),
        before =
            db.queryForObject(
                "select payload::text from evaluation_run where id=?", String.class, id);
    var score =
        new EvaluationScoringService.Request(
            "c1", "vector", true, "human", "逐句核对第一段原文", "rubric-v1", true, List.of());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> scoring.score(bob, id, score));
    var first = scoring.score(alice, id, score);
    var second =
        scoring.score(
            alice,
            id,
            new EvaluationScoringService.Request(
                "c1",
                "vector",
                false,
                "human",
                "复核发现结论超出原文",
                "rubric-v2",
                false,
                List.of("unsupported_answer", "unsupported_citation")));
    assertEquals(alice, second.get("scoredBy"));
    assertNotNull(second.get("scoredAt"));
    assertNotEquals(first.get("id"), second.get("id"));
    assertEquals(
        before,
        db.queryForObject("select payload::text from evaluation_run where id=?", String.class, id));
    var saved = (Map<?, ?>) evaluations.get(alice, id);
    assertEquals(2, ((List<?>) saved.get("manualScores")).size());
    var row = (Map<?, ?>) ((List<?>) saved.get("results")).getFirst();
    assertNull(row.get("answerCorrect"));
    assertEquals(false, ((Map<?, ?>) row.get("manualScore")).get("answerCorrect"));
    mvc.perform(
            get("/api/evaluations/" + id + "/export")
                .header("Authorization", "Bearer " + aliceToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.manualScores.length()").value(2));
    mvc.perform(
            get("/api/evaluations/" + id + "/export").header("Authorization", "Bearer " + bobToken))
        .andExpect(status().isNotFound());
  }

  @Test
  void strictHttpRejectsUnknownFieldsAndSpoofedScorer() throws Exception {
    String body = json.encode(request(dataset(label())));
    mvc.perform(
            post("/api/evaluations")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(
                    body.replace(
                        "\"sourceHash\":null", "\"sourceHash\":null,\"documentId\":\"foreign\"")))
        .andExpect(status().isBadRequest());
    var run = evaluations.run(alice, request(dataset(label())));
    String id = (String) run.get("id");
    String score =
        "{\"caseId\":\"c1\",\"mode\":\"vector\",\"answerCorrect\":true,\"source\":\"human\",\"rationale\":\"checked\",\"ruleVersion\":\"v1\",\"errorCategories\":[],\"citationSupported\":true}";
    mvc.perform(
            post("/api/evaluations/" + id + "/scores")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(score))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scoredBy").value(alice));
    mvc.perform(
            post("/api/evaluations/" + id + "/scores")
                .header("Authorization", "Bearer " + bobToken)
                .contentType("application/json")
                .content(score))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/evaluations/" + id + "/scores")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(
                    score.replace(
                        "\"source\":\"human\"", "\"source\":\"human\",\"scoredBy\":\"bob\"")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void rejectsRunningUnknownRowsAndInvalidScoringTaxonomy() {
    var run = evaluations.run(alice, request(dataset(label())));
    String id = (String) run.get("id");
    assertThrows(
        IllegalArgumentException.class,
        () ->
            scoring.score(
                alice,
                id,
                new EvaluationScoringService.Request(
                    "missing", "vector", true, "human", "checked", "v1", null, List.of())));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            scoring.score(
                alice,
                id,
                new EvaluationScoringService.Request(
                    "c1", "vector", true, "llm", "checked", "v1", null, List.of())));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            scoring.score(
                alice,
                id,
                new EvaluationScoringService.Request(
                    "c1", "vector", true, "human", "checked", "v1", null, List.of("invented"))));
    db.update("update evaluation_run set status='RUNNING' where id=?", id);
    var error =
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () ->
                scoring.score(
                    alice,
                    id,
                    new EvaluationScoringService.Request(
                        "c1", "vector", true, "human", "checked", "v1", null, List.of())));
    assertEquals(409, error.getStatusCode().value());
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from evaluation_score where evaluation_id=?", Integer.class, id));
  }
}
