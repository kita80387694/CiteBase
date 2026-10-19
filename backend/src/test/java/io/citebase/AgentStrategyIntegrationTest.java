package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.*;
import org.junit.jupiter.api.*;

class AgentStrategyIntegrationTest extends AgentIntegrationTest {
  @BeforeEach
  void experimentalPlanner() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenReturn(new AgentDecision("finish", Map.of(), "finish-experimental", null, null, null));
  }

  @Test
  void groundedPoliciesPersistSeparateGenerationVersionAndKeepCitations() {
    for (String strategy : List.of("grounded-answer-v1", "combined-grounded-v1")) {
      String id = create(strategy, ",\"strategy\":\"" + strategy + "\"");
      var run = runAgent(alice, id);
      assertEquals("COMPLETED", run.get("status"));
      assertTrue((Boolean) result(run).get("citationValid"));
      assertEquals("grounded-answer-v1", ((Map<?, ?>) run.get("config")).get("generationPolicy"));
      assertEquals(strategy, result(run).get("strategy"));
    }
    verify(model, times(2))
        .generateBounded(anyString(), anyList(), anyInt(), anyInt(), eq("grounded-answer-v1"));
  }

  @Test
  void preservesOriginalStoredRequestHashAndExplicitDefaultIdempotency() {
    String id = create("legacy-compatible", "");
    var stored = db.queryForMap("SELECT request::text,request_hash FROM agent_run WHERE id=?", id);
    assertFalse(stored.get("request").toString().contains("strategy"));
    var req = request("legacy-compatible", "");
    @SuppressWarnings("unchecked")
    var legacy = (Map<String, Object>) questions.decode(questions.encode(req));
    legacy.remove("strategy");
    assertEquals(
        AuthService.hash(
            questions.encode(legacy).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
        stored.get("request_hash"));
    assertEquals(id, create("legacy-compatible", ",\"strategy\":\"original\""));
    assertEquals("original", runs.request(runs.get(alice, id)).strategy());
  }

  @Test
  void strategiesPersistAndCompleteWithServerValidatedCitations() {
    for (String strategy : List.of("inspection-free-v1", "stop-aware-v1", "combined-v1")) {
      String id = create(strategy, ",\"strategy\":\"" + strategy + "\"");
      var run = runAgent(alice, id);
      assertEquals("COMPLETED", run.get("status"));
      assertEquals(strategy, result(run).get("strategy"));
      assertTrue((Boolean) result(run).get("citationValid"));
      assertEquals(strategy, ((Map<?, ?>) run.get("config")).get("agentStrategy"));
      assertTrue(questions.encode(run.get("steps")).contains("allowedTools"));
    }
  }

  @Test
  void forgedDisabledToolFailsBeforeExecution() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenReturn(
            new AgentDecision(
                "inspectCitation",
                Map.of("evidenceHandle", "E1"),
                "forged-disabled",
                null,
                null,
                null));
    var run = runAgent(alice, create("disabled", ",\"strategy\":\"inspection-free-v1\""));
    assertEquals("FAILED", run.get("status"));
    assertEquals("INVALID_ACTION", run.get("errorCode"));
    verify(agentTools, never()).call(anyString(), any(), eq("inspectCitation"), anyMap(), anyMap());
    verify(model, never()).generateBounded(anyString(), anyList(), anyInt(), anyInt());
  }

  @Test
  void lastPlannerCannotSmuggleAdditionalSearch() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenReturn(
            new AgentDecision("search", Map.of("query", "new query"), "extra", null, null, null));
    var run =
        runAgent(
            alice,
            create(
                "last-step", ",\"strategy\":\"stop-aware-v1\",\"budget\":{\"maxPlannerSteps\":1}"));
    assertEquals("INVALID_ACTION", run.get("errorCode"));
    verify(agentTools, times(1)).call(anyString(), any(), eq("search"), anyMap(), anyMap());
  }

  @Test
  void repeatedSearchRemainsFailureNotSuccessfulFallback() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenReturn(
            new AgentDecision(
                "search", Map.of("query", "alpha port"), "duplicate-query", null, null, null));
    var run = runAgent(alice, create("repeat-query", ",\"strategy\":\"combined-v1\""));
    assertEquals("NO_PROGRESS", run.get("errorCode"));
    assertEquals("FAILED", run.get("status"));
    verify(model, never()).generateBounded(anyString(), anyList(), anyInt(), anyInt());
  }

  @Test
  void newStrategyStillEnforcesCancellation() {
    String id = create("cancel-new", ",\"strategy\":\"combined-v1\"");
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenAnswer(
            i -> {
              runs.cancel(alice, id);
              return new AgentDecision("finish", Map.of(), "late-finish", null, null, null);
            });
    var run = runAgent(alice, id);
    assertEquals("CANCELLED", run.get("status"));
    verify(model, never()).generateBounded(anyString(), anyList(), anyInt(), anyInt());
  }

  @Test
  void newStrategyStillRejectsChangedSource() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenAnswer(
            i -> {
              String doc =
                  db.queryForObject("SELECT id FROM document WHERE kb_id=?", String.class, kb);
              documents.upload(
                  alice,
                  kb,
                  doc,
                  "policy.md",
                  "updated source".getBytes(java.nio.charset.StandardCharsets.UTF_8));
              worker.processOne();
              return new AgentDecision("finish", Map.of(), "stale-finish", null, null, null);
            });
    var run = runAgent(alice, create("changed-new", ",\"strategy\":\"combined-v1\""));
    assertEquals("SOURCE_CHANGED", run.get("errorCode"));
    assertTrue(((List<?>) result(run).get("evidence")).isEmpty());
  }

  @Test
  void noEvidenceExplicitlyAbstainsWithoutPlannerOrGeneration() {
    doReturn(new AgentToolService.ToolResult(List.of(), null, null))
        .when(agentTools)
        .call(anyString(), any(), eq("search"), anyMap(), anyMap());
    var run = runAgent(alice, create("empty-new", ",\"strategy\":\"combined-v1\""));
    assertEquals("COMPLETED", run.get("status"));
    assertEquals(Citations.ABSTENTION, result(run).get("answer"));
    verify(planner, never()).plan(anyString(), anyList(), anyList(), anyInt(), anyInt(), any());
    verify(model, never()).generateBounded(anyString(), anyList(), anyInt(), anyInt());
  }

  @Test
  void newStrategyDeadlineStillTerminatesWithoutAnswer() {
    when(planner.plan(
            anyString(),
            anyList(),
            anyList(),
            anyInt(),
            anyInt(),
            any(AgentStrategy.Constraints.class)))
        .thenAnswer(
            i -> {
              Thread.sleep(1500);
              return new AgentDecision("finish", Map.of(), "late", null, null, null);
            });
    var run =
        runAgent(
            alice,
            create(
                "timeout-new", ",\"strategy\":\"combined-v1\",\"budget\":{\"deadlineSeconds\":1}"));
    assertEquals("FAILED", run.get("status"));
    assertEquals("TIMEOUT", run.get("errorCode"));
    verify(model, never()).generateBounded(anyString(), anyList(), anyInt(), anyInt());
  }
}
