package io.citebase;

import java.util.List;
import java.util.Map;

public interface AgentPlannerGateway {
  AgentDecision plan(
      String question,
      List<Evidence> aliasEvidence,
      List<Map<String, Object>> actions,
      int maxOutputTokens,
      int timeoutSeconds);

  default Map<String, Object> configuration() {
    return Map.of("provider", "mock-local");
  }
}
