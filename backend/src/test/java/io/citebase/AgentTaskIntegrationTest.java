package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

class AgentTaskIntegrationTest extends Stage2RetrievalIntegrationTest {
  @Autowired AgentRunRepository runs;
  @Autowired AgentInput input;
  @Autowired AgentService agent;
  @Autowired AgentTaskHandler handler;
  @Autowired TaskRepository tasks;
  @MockitoBean AgentPlannerGateway planner;

  @BeforeEach
  void planner() {
    when(planner.configuration()).thenReturn(Map.of("model", "test-planner"));
    when(planner.plan(anyString(), anyList(), anyList(), anyInt(), anyInt()))
        .thenReturn(new AgentDecision("finish", Map.of(), "finish", 3L, 2L, null));
  }

  String create(String key) {
    return runs.create(
            alice,
            input.parse(
                "{\"kbId\":\""
                    + kb
                    + "\",\"question\":\"alpha port\",\"idempotencyKey\":\""
                    + key
                    + "\"}"))
        .get("id")
        .toString();
  }

  TaskLease lease(String id) {
    agent.execute(alice, id);
    return tasks.claim("controlled-worker", Set.of(TaskKind.AGENT)).orElseThrow();
  }

  TaskResult execute(TaskLease lease) {
    TaskContext.bind(new TaskContext(lease, tasks));
    try {
      return handler.execute(TaskContext.current());
    } finally {
      TaskContext.clear();
    }
  }

  @Test
  void sameOwnerSameKbCannotWriteAnotherRunUsingForeignLease() {
    String a = create("a"), b = create("b");
    var lease = lease(a);
    TaskContext.bind(new TaskContext(lease, tasks));
    try {
      assertThrows(TaskSignal.class, () -> runs.claim(alice, b));
      assertTrue(runs.claim(alice, a));
      Object snapshot = runs.get(alice, a).get("snapshot");
      assertThrows(TaskSignal.class, () -> runs.check(alice, b, snapshot));
      assertThrows(
          TaskSignal.class,
          () -> runs.step(alice, b, snapshot, Map.of("sequence", 1, "action", "foreign")));
      assertThrows(
          TaskSignal.class,
          () -> runs.finish(alice, b, snapshot, "COMPLETED", null, Map.of("answer", "foreign")));
      assertEquals(
          0, db.queryForObject("select count(*) from agent_step where run_id=?", Integer.class, b));
      assertEquals(
          0,
          db.queryForObject(
              "select count(*) from work_checkpoint where task_id=?", Integer.class, a));
      assertEquals("CREATED", runs.get(alice, b).get("status"));
    } finally {
      TaskContext.clear();
    }
  }

  @Test
  void missingLeaseCannotBypassTaskFencing() {
    String id = create("unbound");
    var lease = lease(id);
    TaskContext.bind(new TaskContext(lease, tasks));
    try {
      assertTrue(runs.claim(alice, id));
    } finally {
      TaskContext.clear();
    }
    Object snapshot = runs.get(alice, id).get("snapshot");
    assertThrows(TaskSignal.class, () -> runs.check(alice, id, snapshot));
    assertThrows(TaskSignal.class, () -> runs.step(alice, id, snapshot, Map.of("sequence", 1)));
    assertThrows(
        TaskSignal.class,
        () -> runs.finish(alice, id, snapshot, "COMPLETED", null, Map.of("answer", "unfenced")));
    assertEquals("RUNNING", runs.get(alice, id).get("status"));
    assertEquals(
        0, db.queryForObject("select count(*) from agent_step where run_id=?", Integer.class, id));
  }

  @Test
  void completeOutcomeRecoveredWithoutRepeatingModelCalls() {
    String id = create("outcome");
    var old = lease(id);
    TaskResult result = execute(old);
    int count =
        db.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id);
    assertTrue(count > 0);
    db.update(
        "update work_task set lease_until=clock_timestamp()-interval '1 second' where id=?", id);
    var next = tasks.claim("replacement", Set.of(TaskKind.AGENT)).orElseThrow();
    var recovered = execute(next);
    assertEquals(result.result(), recovered.result());
    tasks.succeed(next, recovered);
    assertEquals("COMPLETED", runs.get(alice, id).get("status"));
    assertEquals(
        count,
        db.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id));
    verify(planner, times(1)).plan(anyString(), anyList(), anyList(), anyInt(), anyInt());
    assertThrows(TaskSignal.class, () -> tasks.succeed(old, result));
  }

  @Test
  void concurrentCancelAndEnqueueNeverLeavesRunnableCancelledDomain() throws Exception {
    for (int n = 0; n < 8; n++) {
      String id = create("race-" + n);
      var start = new CountDownLatch(1);
      try (var pool = Executors.newFixedThreadPool(2)) {
        var execute =
            pool.submit(
                () -> {
                  start.await();
                  return agent.execute(alice, id);
                });
        var cancel =
            pool.submit(
                () -> {
                  start.await();
                  return runs.cancel(alice, id);
                });
        start.countDown();
        execute.get(10, TimeUnit.SECONDS);
        cancel.get(10, TimeUnit.SECONDS);
      }
      assertEquals("CANCELLED", runs.get(alice, id).get("status"));
      var rows = db.queryForList("select status from work_task where id=?", id);
      if (!rows.isEmpty()) assertEquals("CANCELLED", rows.getFirst().get("status"));
    }
    assertTrue(tasks.claim("worker", Set.of(TaskKind.AGENT)).isEmpty());
    verifyNoInteractionsAfterConfig();
  }

  void verifyNoInteractionsAfterConfig() {
    verify(planner, never()).plan(anyString(), anyList(), anyList(), anyInt(), anyInt());
  }

  @Test
  void manualRetryWithoutCallsClearsOldOutcomeAndPartial() {
    String id = create("retry");
    var l = lease(id);
    tasks.checkpoint(
        l,
        "agent-outcome",
        Map.of("status", "FAILED", "error", "CONFIG_CHANGED", "result", Map.of("answer", "old")));
    tasks.checkpoint(l, "agent-partial", Map.of("answer", "old partial"));
    tasks.fail(l, new TaskFailure("CONFIG_CHANGED", "配置已变化", false, false));
    assertEquals("FAILED", runs.get(alice, id).get("status"));
    tasks.retry(alice, id);
    assertEquals("CREATED", runs.get(alice, id).get("status"));
    assertNull(runs.get(alice, id).get("result"));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from work_checkpoint where task_id=?", Integer.class, id));
    assertTrue(taskWorker.processOne(Set.of(TaskKind.AGENT)));
    assertEquals("COMPLETED", runs.get(alice, id).get("status"));
  }

  @Test
  void sourceChangeAfterOutcomeRejectsPublishAndRedactsEvidence() {
    String id = create("version");
    var l = lease(id);
    var outcome = execute(l);
    documents.upload(
        alice, kb, null, "new.md", "new source".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertTrue(worker.processOne());
    TaskSignal error = assertThrows(TaskSignal.class, () -> tasks.succeed(l, outcome));
    assertEquals("SOURCE_CHANGED", error.code());
    tasks.fail(l, new TaskFailure(error.code(), "来源变化", false, false));
    var view = runs.get(alice, id);
    assertEquals("FAILED", view.get("status"));
    var result = (Map<?, ?>) view.get("result");
    assertEquals(List.of(), result.get("evidence"));
    assertEquals(List.of(), result.get("citations"));
    assertEquals("", result.get("answer"));
    assertTrue(questions.encode(result.get("usage")).contains("3"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> tasks.retry(alice, id));
  }

  @Test
  void recoveryRebuildsReturnedUsageWithoutDuplicatingStalePartial() {
    String id = create("usage-window");
    var old = lease(id);
    TaskContext.bind(new TaskContext(old, tasks));
    try {
      assertTrue(runs.claim(alice, id));
    } finally {
      TaskContext.clear();
    }
    tasks.checkpoint(
        old,
        "agent-partial",
        Map.of(
            "usage",
            List.of(Map.of("kind", "planner", "actual", Map.of("promptTokens", 999))),
            "answer",
            "withdraw",
            "evidence",
            List.of("withdraw")));
    var returned = tasks.beginExternalCall(old, "planner", "planner", "hash");
    tasks.completeExternalCall(
        old, returned, Map.of("received", true), Map.of("promptTokens", 13, "completionTokens", 2));
    tasks.beginExternalCall(old, "final", "chat", "hash2");
    db.update(
        "update work_task set lease_until=clock_timestamp()-interval '1 second' where id=?", id);
    assertTrue(taskWorker.processOne(Set.of(TaskKind.AGENT)));
    var run = runs.get(alice, id);
    assertEquals("UNSAFE_TO_RESUME", run.get("errorCode"));
    var result = (Map<?, ?>) run.get("result");
    var usage = (List<?>) result.get("usage");
    assertEquals(2, usage.size());
    assertTrue(questions.encode(usage).contains("13"));
    assertFalse(questions.encode(usage).contains("999"));
    assertEquals("generation", ((Map<?, ?>) usage.get(1)).get("kind"));
    assertNull(((Map<?, ?>) usage.get(1)).get("actual"));
    assertEquals(true, result.get("inFlightUsageUnavailable"));
    assertEquals(List.of(), result.get("evidence"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> tasks.retry(alice, id));
    verify(planner, never()).plan(anyString(), anyList(), anyList(), anyInt(), anyInt());
  }
}
