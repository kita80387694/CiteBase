package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class AgentInputTest {
  final AgentInput input = new AgentInput();
  String base = "\"kbId\":\"kb\",\"question\":\"q\",\"idempotencyKey\":\"key\"";

  @Test
  void strictDefaultsAndReducedBudgets() {
    var r = input.parse("{" + base + "}");
    assertEquals(AgentPolicy.DEFAULT, r.budget());
    assertEquals("vector", r.mode());
    assertFalse(r.retrievalOptions().rerank());
    assertEquals(1, input.parse("{" + base + ",\"budget\":{\"maxTools\":1}}").budget().maxTools());
  }

  @Test
  void rejectEscalationCoercionUnknownNulAndDuplicate() {
    for (String extra :
        new String[] {
          "\"budget\":{\"maxTools\":5}",
          "\"budget\":{\"concurrency\":3}",
          "\"budget\":{\"deadlineSeconds\":0}",
          "\"topK\":\"5\"",
          "\"ownerId\":\"bob\"",
          "\"retrievalOptions\":{\"rerank\":\"true\"}"
        })
      assertThrows(
          IllegalArgumentException.class, () -> input.parse("{" + base + "," + extra + "}"));
    assertThrows(
        IllegalArgumentException.class,
        () -> input.parse("{" + base + ",\"question\":\"changed\"}"));
    assertThrows(
        IllegalArgumentException.class,
        () -> input.parse("{" + base.replace("\"q\"", "\"q\\u0000\"") + "}"));
  }

  @Test
  void exactToolArgsAndBudgetEnforced() {
    assertThrows(
        AgentPolicy.Stop.class,
        () ->
            AgentToolService.exact(
                java.util.Map.of("query", "q", "kbId", "foreign"), java.util.Set.of("query")));
    var c = new AgentPolicy.Context(new AgentPolicy(1, 1, 1, 1, 10, 1, 1, 1, 1));
    c.external();
    assertEquals("BUDGET_EXCEEDED", assertThrows(AgentPolicy.Stop.class, c::external).code);
    c.tool(true);
    assertThrows(AgentPolicy.Stop.class, () -> c.tool(false));
  }
}
