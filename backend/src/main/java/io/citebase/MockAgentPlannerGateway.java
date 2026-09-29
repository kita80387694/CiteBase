package io.citebase;

import java.util.List;
import java.util.Map;

/** Explicit workflow fixture, never a model-quality result. */
public class MockAgentPlannerGateway implements AgentPlannerGateway {
  public AgentDecision plan(
      String question,
      List<Evidence> evidence,
      List<Map<String, Object>> actions,
      int maxOutputTokens,
      int timeoutSeconds) {
    return new AgentDecision("finish", Map.of(), "mock-finish", null, null, null);
  }
}
