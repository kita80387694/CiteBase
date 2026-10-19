package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

abstract class RagScenarios {
  @Autowired JdbcTemplate db;
  @Autowired DocumentService documents;
  @Autowired AuthService auth;
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

  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean ModelGateway model;

  @AfterEach
  void resetModel() {
    org.mockito.Mockito.reset(model);
  }

  String alice, bob, kb, document;

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    alice = (String) auth.login("alice", "Alice-demo-123!").get("userId");
    bob = (String) auth.login("bob", "Bob-demo-123!").get("userId");
    kb = UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,'RAG测试')", kb, alice);
    document =
        (String)
            documents
                .upload(
                    alice,
                    kb,
                    null,
                    "guide.md",
                    "Java rollback uses transaction isolation.\n\n知识库检索必须限制用户权限。"
                        .getBytes(StandardCharsets.UTF_8))
                .get("id");
    worker.processOne();
  }

  @Test
  void realSqlIsolatesRetrievalHistoryCitationAndEvaluation() {
    for (String mode : List.of("vector", "hybrid")) {
      var answer = questions.ask(alice, kb, "Java rollback", mode, 5, true);
      assertFalse(answer.evidence().isEmpty());
      assertTrue(answer.citationValid());
      assertThrows(
          org.springframework.web.server.ResponseStatusException.class,
          () -> questions.ask(bob, kb, "Java rollback", mode, 5, true));
      assertThrows(
          org.springframework.web.server.ResponseStatusException.class,
          () -> retrieval.citation(bob, answer.evidence().getFirst().id()));
    }
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> questions.history(bob, kb));
    var run = runEvaluation(alice, request());
    assertEquals("SUCCEEDED", run.get("status"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> evaluations.get(bob, (String) run.get("id")));
    var serialized = questions.encode(run);
    assertTrue(serialized.contains("dataVersions"));
    assertTrue(serialized.contains("referenceAnswerMatch"));
    assertTrue(serialized.contains("\"answerCorrect\":null"));
    assertEquals(4, ((List<?>) run.get("results")).size());
  }

  @Test
  void deletionRevokesSavedAnswersEvaluationAndEvidence() {
    var answer = questions.ask(alice, kb, "Java rollback", "vector", 5, true);
    runEvaluation(alice, request());
    documents.delete(alice, document);
    assertTrue(questions.history(alice, kb).isEmpty());
    assertTrue(evaluations.list(alice).isEmpty());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> retrieval.citation(alice, answer.evidence().getFirst().id()));
    assertTrue(questions.ask(alice, kb, "Java rollback", "hybrid", 5, true).abstained());
  }

  @Test
  void legacyInterruptedEvaluationIsNotBlanketRecoveredByAnotherInstance() {
    String id = UUID.randomUUID().toString();
    db.update(
        "insert into evaluation_run(id,user_id,kb_id,name,status,payload)"
            + " values(?,?,?,'interrupted','RUNNING','{\"status\":\"RUNNING\",\"results\":[{\"caseId\":\"saved\"}]}')",
        id,
        alice,
        kb);
    // Startup no longer steals or rewrites other instances / legacy records.
    String saved = questions.encode(evaluations.get(alice, id));
    assertTrue(saved.contains("RUNNING"));
    assertTrue(saved.contains("saved"));
  }

  @Test
  void unfinishedEvaluationCommitsEachQuestionForOtherConnections() throws Exception {
    var paused = new java.util.concurrent.CountDownLatch(1);
    var resume = new java.util.concurrent.CountDownLatch(1);
    var calls = new java.util.concurrent.atomic.AtomicInteger();
    org.mockito.Mockito.doAnswer(
            invocation -> {
              if (calls.incrementAndGet() == 2) {
                paused.countDown();
                assertTrue(resume.await(10, java.util.concurrent.TimeUnit.SECONDS));
              }
              return invocation.callRealMethod();
            })
        .when(model)
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var task = pool.submit(() -> runEvaluation(alice, request()));
      try {
        assertTrue(paused.await(10, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(
            "RUNNING",
            db.queryForObject("select status from evaluation_run where kb_id=?", String.class, kb));
        assertEquals(
            1,
            db.queryForObject(
                "select count(*) from evaluation_item i join evaluation_run r on"
                    + " r.id=i.evaluation_id where r.kb_id=? and i.result is not null",
                Integer.class,
                kb));
        var concurrentQuestion =
            pool.submit(() -> questions.ask(alice, kb, "Java rollback", "hybrid", 5, true));
        assertTrue(
            concurrentQuestion.get(3, java.util.concurrent.TimeUnit.SECONDS).citationValid());
        assertFalse(task.isDone(), "评测仍暂停时，同知识库问答应已完成");
      } finally {
        resume.countDown();
      }
      assertEquals("SUCCEEDED", task.get(10, java.util.concurrent.TimeUnit.SECONDS).get("status"));
    }
  }

  @Test
  void deletionDoesNotWaitForEvaluationAndRevokesLateResults() throws Exception {
    var paused = new java.util.concurrent.CountDownLatch(1);
    var resume = new java.util.concurrent.CountDownLatch(1);
    org.mockito.Mockito.doAnswer(
            invocation -> {
              paused.countDown();
              assertTrue(resume.await(15, java.util.concurrent.TimeUnit.SECONDS));
              return invocation.callRealMethod();
            })
        .when(model)
        .generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    var created = evaluations.create(alice, request());
    String id = (String) created.get("id");
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var execution = pool.submit(() -> taskWorker.processOne(Set.of(TaskKind.EVALUATION)));
      assertTrue(paused.await(10, java.util.concurrent.TimeUnit.SECONDS));
      try {
        pool.submit(() -> documents.delete(alice, document))
            .get(3, java.util.concurrent.TimeUnit.SECONDS);
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () -> evaluations.get(alice, id));
      } finally {
        resume.countDown();
      }
      execution.get(10, java.util.concurrent.TimeUnit.SECONDS);
    }
    assertTrue(evaluations.list(alice).isEmpty());
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from evaluation_item where evaluation_id=?", Integer.class, id));
  }

  EvaluationService.Request request() {
    return new EvaluationService.Request(
        kb,
        "test",
        new EvaluationService.Dataset(
            "v1",
            List.of(
                new EvaluationService.Case(
                    "answerable",
                    "Java rollback",
                    true,
                    "transaction isolation",
                    List.of(
                        new EvaluationMetrics.Label("guide.md", 1, 1, "transaction isolation"))),
                new EvaluationService.Case(
                    "unanswerable", "月球天气 forecast", false, null, List.of()))),
        5);
  }
}
