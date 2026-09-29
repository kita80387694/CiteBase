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

@SpringBootTest(
    properties = {
      "citebase.worker-enabled=false",
      "MODEL_MODE=mock",
      "RERANK_API_KEY=must-never-be-used"
    })
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class Stage2RetrievalIntegrationTest {
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
  @Autowired QuestionService questions;
  @Autowired RetrievalService retrieval;
  @Autowired EvaluationService evaluations;
  @Autowired TaskWorker taskWorker;

  @SuppressWarnings("unchecked")
  Map<String, Object> runEvaluation(String user, EvaluationService.Request request) {
    var created = evaluations.create(user, request);
    org.junit.jupiter.api.Assertions.assertTrue(taskWorker.processOne(Set.of(TaskKind.EVALUATION)));
    return (Map<String, Object>) evaluations.get(user, (String) created.get("id"));
  }

  @Autowired MockMvc mvc;
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean ModelGateway model;
  String alice, bob, kb, other, aliceToken;

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    var a = auth.login("alice", "Alice-demo-123!");
    alice = (String) a.get("userId");
    aliceToken = (String) a.get("token");
    bob = (String) auth.login("bob", "Bob-demo-123!").get("userId");
    kb = UUID.randomUUID().toString();
    other = UUID.randomUUID().toString();
    db.update(
        "insert into knowledge_base(id,user_id,name) values(?,?,'a'),(?,?,'b')",
        kb,
        alice,
        other,
        bob);
    documents.upload(
        alice,
        kb,
        null,
        "policy.md",
        "alpha port is 9081.\n\nbeta timeout is 12 seconds.\n\ngamma quota is 20."
            .getBytes(StandardCharsets.UTF_8));
    documents.upload(
        bob,
        other,
        null,
        "secret.txt",
        "BOB-ONLY-SECRET alpha port is 4444.".getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    worker.processOne();
    org.mockito.Mockito.clearInvocations(model);
  }

  @AfterEach
  void reset() {
    org.mockito.Mockito.reset(model);
  }

  @Test
  void defaultRankingAndExplicitOptionsKeepAclAndExposeCandidateTrace() {
    var original = retrieval.retrieve(alice, kb, "alpha port", "vector", 1);
    var explicit =
        retrieval.retrieveDetailed(
            alice, kb, "alpha port", "vector", 1, new RetrievalOptions(3, 1., false, "uuid"));
    assertEquals(original.getFirst().id(), explicit.evidence().getFirst().id());
    var trace = questions.encode(explicit.diagnostics());
    assertFalse(trace.contains("BOB-ONLY"));
    assertTrue(trace.contains("candidateCounts"));
    assertEquals(3, ((Map<?, ?>) explicit.diagnostics().get("candidateCounts")).get("vector"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () ->
            questions.diagnose(
                alice, other, "alpha", "hybrid", 5, new RetrievalOptions(20, 0., true, "compact")));
    org.mockito.Mockito.clearInvocations(model);
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> questions.diagnose(bob, kb, "alpha", "vector", 5, null));
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .embedWithUsage(org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void compactMappingPreservesSourceChecksAndRawResponse() {
    org.mockito.Mockito.doReturn(new Generation("port 9081 [E1]", 10L, 5L, null))
        .when(model)
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    var result =
        questions.ask(
            alice,
            kb,
            "alpha port",
            "vector",
            1,
            true,
            new RetrievalOptions(3, 1., false, "compact"));
    assertTrue(result.citationValid());
    assertEquals(result.evidence().getFirst().id(), result.citations().getFirst().id());
    assertFalse(result.answer().contains("[E1]"));
    assertEquals("port 9081 [E1]", result.diagnostics().get("rawAnswer"));
    assertEquals(10L, result.promptTokens());
    org.mockito.Mockito.doReturn(new Generation("port [E999]", 10L, 5L, null))
        .when(model)
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    var invalid =
        questions.ask(
            alice,
            kb,
            "alpha port",
            "vector",
            1,
            false,
            new RetrievalOptions(3, 1., false, "compact"));
    assertFalse(invalid.citationValid());
    assertTrue(invalid.abstained());
    assertNotNull(invalid.error());
  }

  @Test
  void mockRerankExplicitFailureRetainsDiagnosticsAndDoesNotGenerate() {
    var result =
        questions.ask(
            alice, kb, "alpha port", "hybrid", 1, false, new RetrievalOptions(3, .5, true, "uuid"));
    assertTrue(result.error().contains("MOCK"));
    assertNull(result.usage().get("rerank"));
    assertFalse(
        ((List<?>) ((Map<?, ?>) result.diagnostics().get("trace")).get("vector")).isEmpty());
    assertTrue(result.evidence().isEmpty());
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
  }

  @Test
  void diagnosticsNeverPretendsToBeEndToEndAndEvaluationExportsOptions() throws Exception {
    String body =
        "{\"kbId\":\""
            + kb
            + "\",\"question\":\"alpha"
            + " port\",\"mode\":\"hybrid\",\"topK\":1,\"retrievalOptions\":{\"candidateK\":3,\"keywordWeight\":0,\"rerank\":false,\"citationStyle\":\"uuid\"}}";
    mvc.perform(
            post("/api/retrieval-diagnostics")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.kind").value("retrieval-only"))
        .andExpect(jsonPath("$.answer").doesNotExist())
        .andExpect(jsonPath("$.dataVersions[0].chunk_strategy").exists());
    assertEquals(0, db.queryForObject("select count(*) from question_history", Integer.class));
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    var dataset =
        new EvaluationService.Dataset(
            "opts",
            List.of(
                new EvaluationService.Case(
                    "1",
                    "alpha port",
                    true,
                    "9081",
                    List.of(
                        new EvaluationMetrics.Label("policy.md", 1, 1, "alpha port is 9081.")))));
    var run =
        runEvaluation(
            alice,
            new EvaluationService.Request(
                kb, "options", dataset, 1, new RetrievalOptions(3, 0., false, "uuid")));
    assertEquals("SUCCEEDED", run.get("status"));
    assertTrue(questions.encode(run).contains("retrievalOptions"));
    assertEquals(
        Set.of("vector", "hybrid"),
        ((List<Map<String, Object>>) run.get("results"))
            .stream().map(r -> r.get("mode")).collect(java.util.stream.Collectors.toSet()));
    mvc.perform(
            post("/api/questions")
                .header("Authorization", "Bearer " + aliceToken)
                .contentType("application/json")
                .content(body.replace("\"candidateK\":3", "\"candidateK\":0")))
        .andExpect(status().isBadRequest());
  }
}
