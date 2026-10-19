package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class AgentStrategyUnitTest {
  AgentInput.Request request(String strategy) {
    return new AgentInput.Request(
        "kb",
        "question",
        "vector",
        5,
        RetrievalOptions.defaults(5),
        AgentPolicy.DEFAULT,
        "key",
        strategy);
  }

  Map<String, Evidence> handles() {
    return Map.of("E1", new Evidence("id", "d", "doc", "v", 1, 1, 0, 4, "text", 1));
  }

  @Test
  void originalDefaultsAndEnumAreStrict() {
    assertEquals("original", request(null).strategy());
    assertThrows(IllegalArgumentException.class, () -> request("magic"));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new AgentInput()
                .parse(
                    "{\"kbId\":\"kb\",\"question\":\"q\",\"idempotencyKey\":\"k\",\"strategy\":null}"));
  }

  @Test
  void inspectionFreeDoesNotChangeBudgetOrOtherTools() {
    var r = request("inspection-free-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    var constraints = AgentStrategy.constrain(r, c, handles(), Set.of(), true);
    assertEquals(Set.of("search", "neighbors", "finish"), constraints.allowedTools());
    assertEquals(AgentPolicy.DEFAULT, r.budget());
    assertThrows(
        AgentPolicy.Stop.class,
        () -> constraints.validate("inspectCitation", Map.of("evidenceHandle", "E1")));
  }

  @Test
  void lastPlannerAndToolBudgetPermitOnlyFinish() {
    var r = request("stop-aware-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 4;
    var constraints = AgentStrategy.constrain(r, c, handles(), Set.of(), false);
    assertEquals(Set.of("finish"), constraints.allowedTools());
    c.planners = 1;
    c.tools = 4;
    assertEquals(
        Set.of("finish"), AgentStrategy.constrain(r, c, handles(), Set.of(), false).allowedTools());
  }

  @Test
  void reservesGenerationBeforeCallingPlanner() {
    var r = request("stop-aware-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    c.externalCalls = 9;
    var stop =
        assertThrows(
            AgentPolicy.Stop.class, () -> AgentStrategy.constrain(r, c, handles(), Set.of(), true));
    assertEquals("BUDGET_EXCEEDED", stop.code);
    c.externalCalls = 8;
    var constraints = AgentStrategy.constrain(r, c, handles(), Set.of(), true);
    assertFalse(constraints.allowedTools().contains("search"));
    assertEquals(1, constraints.remainingBudget().get("reservedGenerationCalls"));
    assertEquals(8, c.externalCalls);
  }

  @Test
  void suppressesAlreadyInspectedHandlesAndRejectsRepeatedQuery() {
    var r = request("stop-aware-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    var signatures =
        Set.of(
            AgentStrategy.signature("inspectCitation", Map.of("evidenceHandle", "E1")),
            AgentStrategy.signature("search", Map.of("query", "question")));
    var constraints = AgentStrategy.constrain(r, c, handles(), signatures, false);
    assertFalse(constraints.allowedTools().contains("inspectCitation"));
    assertEquals(
        "NO_PROGRESS",
        assertThrows(
                AgentPolicy.Stop.class,
                () -> constraints.validate("search", Map.of("query", "question")))
            .code);
  }

  @Test
  void dynamicRealGatewaySchemaActuallyOmitsInspection() {
    var r = request("combined-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    var constraints = AgentStrategy.constrain(r, c, handles(), Set.of(), false);
    String schema =
        new com.fasterxml.jackson.databind.ObjectMapper()
            .valueToTree(SpringAiAgentPlannerGateway.tools(constraints))
            .toString();
    assertFalse(schema.contains("inspectCitation"));
    assertTrue(schema.contains("neighbors"));
    assertTrue(schema.contains("E1"));
    assertTrue(schema.contains("finish"));
  }

  @Test
  void constraintsAreImmutableAndIsolatedBetweenRuns() {
    var source = new HashSet<String>();
    var r = request("stop-aware-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    var first = AgentStrategy.constrain(r, c, handles(), source, false);
    source.add(AgentStrategy.signature("search", Map.of("query", "question")));
    assertTrue(first.signatures().isEmpty());
    assertThrows(UnsupportedOperationException.class, () -> first.allowedTools().clear());
    assertFalse(AgentStrategy.constrain(r, c, handles(), source, false).signatures().isEmpty());
  }

  @Test
  void oneRemainingCallAllowsOnlyFinishIncludingLocalTools() {
    var r = request("stop-aware-v1");
    var c = new AgentPolicy.Context(r.budget());
    c.planners = 1;
    c.externalCalls = 8;
    assertEquals(
        Set.of("finish"), AgentStrategy.constrain(r, c, handles(), Set.of(), true).allowedTools());
    c.externalCalls = 7;
    assertTrue(
        AgentStrategy.constrain(r, c, handles(), Set.of(), true)
            .allowedTools()
            .contains("neighbors"));
    assertFalse(
        AgentStrategy.constrain(r, c, handles(), Set.of(), true).allowedTools().contains("search"));
  }

  @Test
  void searchReservesNextPlannerAndGenerationWithAndWithoutRerank() {
    for (boolean rerank : List.of(false, true)) {
      var r =
          new AgentInput.Request(
              "kb",
              "q",
              "vector",
              5,
              new RetrievalOptions(20, 1d, rerank, "uuid"),
              AgentPolicy.DEFAULT,
              "key",
              "stop-aware-v1");
      int required = 2 + (rerank ? 2 : 1);
      var c = new AgentPolicy.Context(r.budget());
      c.planners = 1;
      c.externalCalls = 10 - 1 - required;
      assertTrue(
          AgentStrategy.constrain(r, c, handles(), Set.of(), true)
              .allowedTools()
              .contains("search"));
      c.externalCalls++;
      assertFalse(
          AgentStrategy.constrain(r, c, handles(), Set.of(), true)
              .allowedTools()
              .contains("search"));
    }
  }
}
