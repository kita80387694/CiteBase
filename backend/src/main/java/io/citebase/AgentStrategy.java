package io.citebase;

import java.util.*;

/** Experimental action policies. No semantic sufficiency or quality claim is made here. */
public final class AgentStrategy {
  public static final Set<String> NAMES =
      Set.of("original", "inspection-free-v1", "stop-aware-v1", "combined-v1");

  public static String resolve(String strategy) {
    String s = strategy == null ? "original" : strategy;
    if (!NAMES.contains(s)) throw new IllegalArgumentException("Agent strategy无效");
    return s;
  }

  public static String signature(String action, Map<String, Object> args) {
    return action + new TreeMap<>(args);
  }

  public record Constraints(
      String strategy,
      Set<String> allowedTools,
      Set<String> signatures,
      List<String> inspectHandles,
      List<String> neighborHandles,
      Map<String, Integer> remainingBudget) {
    public Constraints {
      allowedTools = Set.copyOf(allowedTools);
      signatures = Set.copyOf(signatures);
      inspectHandles = List.copyOf(inspectHandles);
      neighborHandles = List.copyOf(neighborHandles);
      remainingBudget = Map.copyOf(remainingBudget);
    }

    public void validate(String action, Map<String, Object> args) {
      if (!allowedTools.contains(action)) throw new AgentPolicy.Stop("INVALID_ACTION");
      if (stopAware(strategy) && signatures.contains(signature(action, args)))
        throw new AgentPolicy.Stop("NO_PROGRESS");
    }

    public Map<String, Object> metadata() {
      return Map.of(
          "strategy",
          strategy,
          "allowedTools",
          allowedTools.stream().sorted().toList(),
          "remainingBudget",
          remainingBudget);
    }
  }

  static boolean stopAware(String s) {
    return s.equals("stop-aware-v1") || s.equals("combined-v1");
  }

  static boolean inspectionFree(String s) {
    return s.equals("inspection-free-v1") || s.equals("combined-v1");
  }

  static Constraints constrain(
      AgentInput.Request r,
      AgentPolicy.Context c,
      Map<String, Evidence> handles,
      Set<String> signatures,
      boolean real) {
    var allowed = new HashSet<>(Set.of("search", "neighbors", "inspectCitation", "finish"));
    if (inspectionFree(r.strategy())) allowed.remove("inspectCitation");
    int externalAfterPlanner = c.externalCalls + (real ? 1 : 0);
    int remaining = Math.max(0, r.budget().maxExternalCalls() - externalAfterPlanner);
    var inspections =
        handles.keySet().stream()
            .filter(
                h ->
                    !signatures.contains(signature("inspectCitation", Map.of("evidenceHandle", h))))
            .toList();
    var neighbors =
        handles.keySet().stream()
            .filter(
                h ->
                    List.of("previous", "next").stream()
                        .anyMatch(
                            d ->
                                !signatures.contains(
                                    signature(
                                        "neighbors", Map.of("evidenceHandle", h, "direction", d)))))
            .toList();
    if (stopAware(r.strategy())) {
      // One final generation call is reserved. A planner call may not spend that reserve.
      if (real && remaining < 1) throw new AgentPolicy.Stop("BUDGET_EXCEEDED");
      if (c.tools >= r.budget().maxTools()
          || c.planners >= r.budget().maxPlannerSteps()
          || real && remaining < 2) allowed.retainAll(Set.of("finish"));
      if (c.searches >= r.budget().maxSearch()
          || real && remaining < 2 + (r.retrievalOptions().rerank() ? 2 : 1))
        allowed.remove("search");
      if (inspections.isEmpty()) allowed.remove("inspectCitation");
      if (neighbors.isEmpty()) allowed.remove("neighbors");
    }
    return new Constraints(
        r.strategy(),
        allowed,
        signatures,
        stopAware(r.strategy()) ? inspections : List.copyOf(handles.keySet()),
        stopAware(r.strategy()) ? neighbors : List.copyOf(handles.keySet()),
        Map.of(
            "plannerSteps",
            Math.max(0, r.budget().maxPlannerSteps() - c.planners),
            "tools",
            Math.max(0, r.budget().maxTools() - c.tools),
            "searches",
            Math.max(0, r.budget().maxSearch() - c.searches),
            "externalCallsAfterPlanner",
            remaining,
            "reservedGenerationCalls",
            stopAware(r.strategy()) && real ? 1 : 0));
  }

  private AgentStrategy() {}
}
