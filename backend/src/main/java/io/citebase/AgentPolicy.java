package io.citebase;

import java.util.*;

public record AgentPolicy(
    int maxPlannerSteps,
    int maxTools,
    int maxSearch,
    int maxEvidence,
    int maxEvidenceChars,
    int deadlineSeconds,
    int maxPlannerOutputTokens,
    int maxFinalOutputTokens,
    int maxExternalCalls) {
  public static final AgentPolicy DEFAULT = new AgentPolicy(4, 4, 2, 12, 20000, 120, 256, 1024, 10);

  public static class Stop extends RuntimeException {
    public final String code;

    public Stop(String code) {
      super(code);
      this.code = code;
    }
  }

  public static final class Context {
    final AgentPolicy policy;
    final long started = System.nanoTime(), deadline;
    int planners, tools, searches, externalCalls;
    long retrievalMs;
    boolean inFlight;
    Runnable guard = () -> {}, onExternal = () -> {};
    final java.util.concurrent.atomic.AtomicReference<Map<String, Object>> checkpoint =
        new java.util.concurrent.atomic.AtomicReference<>();
    final List<Map<String, Object>> usage = new ArrayList<>();

    Context(AgentPolicy p) {
      policy = p;
      deadline = started + p.deadlineSeconds() * 1_000_000_000L;
    }

    void check() {
      if (Thread.currentThread().isInterrupted() || System.nanoTime() >= deadline)
        throw new Stop("TIMEOUT");
      guard.run();
    }

    int seconds() {
      check();
      return Math.max(1, (int) ((deadline - System.nanoTime()) / 1_000_000_000L));
    }

    void external() {
      check();
      if (externalCalls >= policy.maxExternalCalls()) throw new Stop("BUDGET_EXCEEDED");
      externalCalls++;
      inFlight = true;
      onExternal.run();
    }

    void tool(boolean search) {
      check();
      if (tools >= policy.maxTools() || search && searches >= policy.maxSearch())
        throw new Stop("BUDGET_EXCEEDED");
      tools++;
      if (search) searches++;
    }

    void planner() {
      check();
      if (planners >= policy.maxPlannerSteps()) throw new Stop("BUDGET_EXCEEDED");
      planners++;
    }

    void used(String kind, Object actual) {
      var m = new LinkedHashMap<String, Object>();
      m.put("kind", kind);
      m.put("actual", actual);
      usage.add(m);
      inFlight = false;
      onExternal.run();
    }

    Map<String, Object> counters(Collection<Evidence> evidence) {
      return Map.of(
          "plannerSteps",
          planners,
          "tools",
          tools,
          "searches",
          searches,
          "externalCalls",
          externalCalls,
          "evidenceCount",
          evidence.size(),
          "evidenceChars",
          evidence.stream().mapToInt(e -> e.text().length()).sum());
    }
  }

  private static final ThreadLocal<Context> CURRENT = new ThreadLocal<>();

  static void bind(Context c) {
    CURRENT.set(c);
  }

  static void clear() {
    CURRENT.remove();
  }

  public static void beforeExternal() {
    var c = CURRENT.get();
    if (c != null) c.external();
  }

  public static void externalUsage(String kind, Object usage) {
    var c = CURRENT.get();
    if (c != null) c.used(kind, usage);
  }
}
