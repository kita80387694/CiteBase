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
    var run = evaluations.run(alice, request());
    assertEquals("COMPLETED", run.get("status"));
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
    evaluations.run(alice, request());
    documents.delete(alice, document);
    assertTrue(questions.history(alice, kb).isEmpty());
    assertTrue(evaluations.list(alice).isEmpty());
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> retrieval.citation(alice, answer.evidence().getFirst().id()));
    assertTrue(questions.ask(alice, kb, "Java rollback", "hybrid", 5, true).abstained());
  }

  @Test
  void interruptedEvaluationRecoveryPreservesPartialPayload() {
    String id = UUID.randomUUID().toString();
    db.update(
        "insert into evaluation_run(id,user_id,kb_id,name,status,payload)"
            + " values(?,?,?,'interrupted','RUNNING','{\"status\":\"RUNNING\",\"results\":[{\"caseId\":\"saved\"}]}')",
        id,
        alice,
        kb);
    evaluations.recover();
    String saved = questions.encode(evaluations.get(alice, id));
    assertTrue(saved.contains("FAILED"));
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
      var task = pool.submit(() -> evaluations.run(alice, request()));
      try {
        assertTrue(paused.await(10, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(
            "RUNNING",
            db.queryForObject("select status from evaluation_run where kb_id=?", String.class, kb));
        assertEquals(
            1,
            db.queryForObject(
                "select jsonb_array_length(payload->'results') from evaluation_run where kb_id=?",
                Integer.class,
                kb));
        var concurrentQuestion =
            pool.submit(() -> questions.ask(alice, kb, "Java rollback", "hybrid", 5, true));
        assertTrue(concurrentQuestion.get(3, java.util.concurrent.TimeUnit.SECONDS).citationValid());
        assertFalse(task.isDone(), "评测仍暂停时，同知识库问答应已完成");
      } finally {
        resume.countDown();
      }
      assertEquals("COMPLETED", task.get(10, java.util.concurrent.TimeUnit.SECONDS).get("status"));
    }
  }

  @Test
  void deletionWaitsForEvaluationReadLockThenRevokesResults() throws Exception {
    var paused = new java.util.concurrent.CountDownLatch(1);
    var resume = new java.util.concurrent.CountDownLatch(1);
    var first = new java.util.concurrent.atomic.AtomicBoolean(true);
    org.mockito.Mockito.doAnswer(invocation -> {
      if (first.getAndSet(false)) {
        paused.countDown();
        assertTrue(resume.await(15, java.util.concurrent.TimeUnit.SECONDS));
      }
      return invocation.callRealMethod();
    }).when(model).generate(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyList());
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var evaluation = pool.submit(() -> evaluations.run(alice, request()));
      java.util.concurrent.Future<?> deletion = null;
      try {
        assertTrue(paused.await(10, java.util.concurrent.TimeUnit.SECONDS));
        deletion = pool.submit(() -> documents.delete(alice, document));
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        boolean waiting = false;
        while (System.nanoTime() < deadline) {
          waiting = db.queryForObject("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where l.locktype='advisory' and not l.granted and a.datname=current_database())", Boolean.class);
          if (waiting) break;
          Thread.sleep(20);
        }
        assertTrue(waiting, "删除必须等待当前评测共享读锁");
        assertFalse(deletion.isDone());
      } finally {
        resume.countDown();
      }
      assertEquals("COMPLETED", evaluation.get(10, java.util.concurrent.TimeUnit.SECONDS).get("status"));
      assertNotNull(deletion);
      deletion.get(10, java.util.concurrent.TimeUnit.SECONDS);
      assertTrue(evaluations.list(alice).isEmpty());
      assertEquals(0, db.queryForObject("select count(*) from document where id=?", Integer.class, document));
    }
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
