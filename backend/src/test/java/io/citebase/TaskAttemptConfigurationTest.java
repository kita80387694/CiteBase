package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

@TestPropertySource(
    properties = {
      "AGENT_TASK_MAX_ATTEMPTS=4",
      "EVALUATION_TASK_MAX_ATTEMPTS=6",
      "EVALUATION_ITEM_MAX_ATTEMPTS=3"
    })
class TaskAttemptConfigurationTest extends Stage2RetrievalIntegrationTest {
  @Autowired AgentInput agentInput;
  @Autowired AgentRunRepository runs;

  @Test
  void configuredBudgetsArePersistedInNewTaskSnapshots() {
    var request =
        agentInput.parse(
            "{\"kbId\":\""
                + kb
                + "\",\"question\":\"alpha port?\",\"idempotencyKey\":\"attempt-config\"}");
    var run = runs.create(alice, request);
    runs.enqueue(alice, run.get("id").toString());
    assertEquals(
        4,
        db.queryForObject(
            "select max_attempts from work_task where id=?", Integer.class, run.get("id")));
    var dataset =
        new EvaluationService.Dataset(
            "attempt-config",
            List.of(
                new EvaluationService.Case(
                    "unknown", "unavailable question", false, null, List.of())));
    var evaluation =
        evaluations.create(
            alice,
            new EvaluationService.Request(
                kb, "attempt-config", dataset, 5, null, "evaluation-attempt-config"));
    assertEquals(
        6,
        db.queryForObject(
            "select max_attempts from work_task where id=?", Integer.class, evaluation.get("id")));
    assertEquals(
        List.of(3, 3),
        db.queryForList(
            "select max_attempts from evaluation_item where evaluation_id=? order by mode",
            Integer.class,
            evaluation.get("id")));
  }
}
