package io.citebase;

import java.util.*;
import java.util.concurrent.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AgentService {
  private final AgentRunRepository runs;
  private final AgentToolService tools;
  private final AgentPlannerGateway planner;
  private final ModelGateway model;
  private final Semaphore capacity = new Semaphore(2);
  private final ExecutorService workers =
      Executors.newFixedThreadPool(
          2,
          r -> {
            Thread t = new Thread(r, "citebase-agent");
            t.setDaemon(true);
            return t;
          });

  public AgentService(
      AgentRunRepository runs,
      AgentToolService tools,
      AgentPlannerGateway planner,
      ModelGateway model) {
    this.runs = runs;
    this.tools = tools;
    this.planner = planner;
    this.model = model;
  }

  @jakarta.annotation.PreDestroy
  void close() {
    workers.shutdownNow();
  }

  public Map<String, Object> execute(String user, String id) {
    return runs.enqueue(user, id);
  }

  Map<String, Object> executeLeased(String user, String id) {
    var taskContext = Objects.requireNonNull(TaskContext.current());
    var exited = new CountDownLatch(1);
    var view = runs.get(user, id);
    if (!"CREATED".equals(view.get("status"))) return view;
    if (!capacity.tryAcquire())
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Agent并发上限2，请稍后执行");
    boolean submitted = false;
    try {
      if (!runs.claim(user, id)) return runs.get(user, id);
      var request = runs.request(view);
      var context = new AgentPolicy.Context(request.budget());
      Object snapshot = view.get("snapshot");
      Future<?> future =
          workers.submit(
              () -> {
                TaskContext.bind(taskContext);
                try {
                  work(user, id, request, snapshot, context);
                } finally {
                  TaskContext.clear();
                  capacity.release();
                  exited.countDown();
                }
              });
      submitted = true;
      try {
        future.get(request.budget().deadlineSeconds(), TimeUnit.SECONDS);
      } catch (TimeoutException e) {
        future.cancel(true);
        runs.finish(user, id, snapshot, "FAILED", "TIMEOUT", timedResult(context, "TIMEOUT"));
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        future.cancel(true);
        runs.finish(
            user, id, snapshot, "INTERRUPTED", "INTERRUPTED", timedResult(context, "INTERRUPTED"));
      } catch (ExecutionException e) {
        runs.finish(user, id, snapshot, "FAILED", "EXECUTION_ERROR", null);
      }
      return runs.get(user, id);
    } finally {
      if (!submitted) capacity.release();
      else {
        boolean interrupted = Thread.interrupted();
        while (exited.getCount() > 0) {
          try {
            exited.await();
          } catch (InterruptedException e) {
            interrupted = true;
          }
        }
        if (interrupted) Thread.currentThread().interrupt();
      }
    }
  }

  private void work(
      String user,
      String id,
      AgentInput.Request request,
      Object snapshot,
      AgentPolicy.Context context) {
    context.guard = () -> runs.check(user, id, snapshot);
    AgentPolicy.bind(context);
    var evidence = new LinkedHashMap<String, Evidence>();
    var handles = new LinkedHashMap<String, Evidence>();
    var actions = new ArrayList<Map<String, Object>>();
    var calls = new HashSet<String>();
    var signatures = new HashSet<String>();
    int[] sequence = {0};
    context.onExternal =
        () -> {
          var partial = failure(request, context, evidence, "IN_PROGRESS");
          context.checkpoint.set(partial);
          if (TaskContext.current() != null) {
            TaskContext.current().checkpoint("agent-partial", partial);
            var progress = new LinkedHashMap<String, Object>();
            progress.put("completed", context.planners);
            progress.put("total", null);
            progress.put("unit", "steps");
            TaskContext.current().progress(progress);
          }
        };
    context.onExternal.run();
    try {
      context.check();
      runs.check(user, id, snapshot);
      perform(
          user,
          id,
          request,
          snapshot,
          context,
          "search",
          Map.of("query", request.question()),
          evidence,
          handles,
          actions,
          signatures,
          sequence);
      while (!evidence.isEmpty()) {
        context.check();
        runs.check(user, id, snapshot);
        context.planner();
        if (model.mode().equals("real")) context.external();
        long started = System.nanoTime();
        TaskCall plannerCall =
            TaskContext.current() == null
                ? null
                : TaskContext.current()
                    .beginExternalCall(
                        "agent/planner/" + context.planners,
                        "planner",
                        AuthService.hash(
                            request.question().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        var decision =
            planner.plan(
                request.question(),
                alias(handles),
                List.copyOf(actions),
                request.budget().maxPlannerOutputTokens(),
                context.seconds());
        var usage = usage(decision.promptTokens(), decision.completionTokens());
        if (plannerCall != null)
          TaskContext.current().completeExternalCall(plannerCall, Map.of("received", true), usage);
        context.used("planner", usage);
        context.onExternal.run();
        context.check();
        runs.check(user, id, snapshot);
        if (decision.error() != null) {
          String error = providerError(decision.error());
          step(
              user,
              id,
              snapshot,
              sequence,
              "planner",
              "decision",
              Map.of(),
              Map.of("error", error),
              usage,
              started);
          throw new AgentPolicy.Stop(error);
        }
        if (decision.toolName() == null
            || !Set.of("search", "neighbors", "inspectCitation", "finish")
                .contains(decision.toolName())
            || decision.callId() == null
            || decision.callId().isBlank()
            || decision.callId().length() > 200
            || !calls.add(decision.callId())
            || decision.arguments() == null) throw new AgentPolicy.Stop("INVALID_ACTION");
        step(
            user,
            id,
            snapshot,
            sequence,
            "planner",
            decision.toolName(),
            Map.of(),
            Map.of("toolName", decision.toolName(), "callId", decision.callId()),
            usage,
            started);
        if ("finish".equals(decision.toolName())) {
          AgentToolService.exact(decision.arguments(), Set.of());
          break;
        }
        perform(
            user,
            id,
            request,
            snapshot,
            context,
            decision.toolName(),
            decision.arguments(),
            evidence,
            handles,
            actions,
            signatures,
            sequence);
      }
      context.check();
      runs.check(user, id, snapshot);
      long started = System.nanoTime();
      var prepared =
          CitationAliases.prepare(
              List.copyOf(evidence.values()), request.retrievalOptions().citationStyle());
      if (!evidence.isEmpty() && model.mode().equals("real")) context.external();
      TaskCall generationCall =
          evidence.isEmpty() || TaskContext.current() == null
              ? null
              : TaskContext.current()
                  .beginExternalCall(
                      "agent/generation",
                      "chat",
                      AuthService.hash(
                          request.question().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
      var generation =
          evidence.isEmpty()
              ? new Generation(Citations.ABSTENTION, null, null, null)
              : model.generateBounded(
                  request.question(),
                  prepared.promptEvidence(),
                  request.budget().maxFinalOutputTokens(),
                  context.seconds());
      if (generationCall != null)
        TaskContext.current()
            .completeExternalCall(
                generationCall,
                Map.of("received", true),
                usage(generation.promptTokens(), generation.completionTokens()));
      context.used("generation", usage(generation.promptTokens(), generation.completionTokens()));
      context.onExternal.run();
      context.check();
      runs.check(user, id, snapshot);
      step(
          user,
          id,
          snapshot,
          sequence,
          "generation",
          "answer",
          Map.of(),
          generation.error() == null
              ? Map.of("received", true)
              : Map.of("error", providerError(generation.error())),
          usage(generation.promptTokens(), generation.completionTokens()),
          started);
      if (generation.error() != null) throw new AgentPolicy.Stop(providerError(generation.error()));
      String restored;
      try {
        restored = CitationAliases.restore(generation.answer(), prepared.aliases());
      } catch (IllegalArgumentException e) {
        throw new AgentPolicy.Stop("INVALID_CITATION");
      }
      var checked = Citations.validate(restored, List.copyOf(evidence.values()));
      if (!checked.valid()) throw new AgentPolicy.Stop("INVALID_CITATION");
      var result = new LinkedHashMap<String, Object>();
      result.put("kind", "bounded-agent");
      result.put("question", request.question());
      result.put("mode", request.mode());
      result.put("retrievalMs", context.retrievalMs);
      result.put("answer", checked.answer());
      result.put("evidence", evidence.values());
      result.put("citations", checked.citations());
      result.put("citationValid", checked.valid());
      result.put("abstained", checked.abstained());
      result.put("error", null);
      result.put("finishReason", checked.abstained() ? "ABSTAINED" : "ANSWERED");
      result.put("modelMode", model.mode());
      result.put("retrievalOptions", request.retrievalOptions());
      result.put("totalMs", (System.nanoTime() - context.started) / 1_000_000);
      result.put("budgetUsed", context.counters(evidence.values()));
      result.put("usage", context.usage);
      result.put("answerCorrect", null);
      runs.finish(user, id, snapshot, "COMPLETED", null, result);
    } catch (TaskSignal e) {
      throw e;
    } catch (AgentPolicy.Stop e) {
      runs.finish(
          user,
          id,
          snapshot,
          e.code.equals("CANCELLED") ? "CANCELLED" : "FAILED",
          e.code,
          failure(request, context, evidence, e.code));
    } catch (ResponseStatusException e) {
      // A tool may lose its active version while the run still exists. Repository finish
      // checks the snapshot and safely does nothing if deletion already removed the run.
      String code = e.getStatusCode().value() == 404 ? "TOOL_NOT_AVAILABLE" : "EXECUTION_ERROR";
      runs.finish(user, id, snapshot, "FAILED", code, failure(request, context, evidence, code));
    } catch (Exception e) {
      // Cancellation can make a provider throw before the HTTP thread persists its timeout.
      // Classify against the same monotonic deadline so the winner of the CAS cannot change it.
      String code =
          System.nanoTime() >= context.deadline
              ? "TIMEOUT"
              : e instanceof InterruptedException ? "INTERRUPTED" : "EXECUTION_ERROR";
      runs.finish(user, id, snapshot, "FAILED", code, failure(request, context, evidence, code));
    } finally {
      AgentPolicy.clear();
    }
  }

  private Map<String, Object> failure(
      AgentInput.Request r, AgentPolicy.Context c, Map<String, Evidence> evidence, String code) {
    var result = new LinkedHashMap<String, Object>();
    result.put("kind", "bounded-agent");
    result.put("question", r.question());
    result.put("mode", r.mode());
    result.put("retrievalMs", c.retrievalMs);
    result.put("answer", Citations.ABSTENTION);
    result.put("evidence", List.copyOf(evidence.values()));
    result.put("citations", List.of());
    result.put("citationValid", false);
    result.put("abstained", true);
    result.put("error", code);
    result.put("finishReason", code);
    result.put("modelMode", model.mode());
    result.put("retrievalOptions", r.retrievalOptions());
    result.put("totalMs", (System.nanoTime() - c.started) / 1_000_000);
    result.put("budgetUsed", c.counters(evidence.values()));
    result.put("usage", List.copyOf(c.usage));
    result.put("inFlightUsageUnavailable", c.inFlight);
    result.put("answerCorrect", null);
    return result;
  }

  private void perform(
      String user,
      String id,
      AgentInput.Request r,
      Object snapshot,
      AgentPolicy.Context c,
      String action,
      Map<String, Object> args,
      LinkedHashMap<String, Evidence> evidence,
      LinkedHashMap<String, Evidence> handles,
      List<Map<String, Object>> actions,
      Set<String> signatures,
      int[] sequence) {
    c.check();
    runs.check(user, id, snapshot);
    String signature = action + new TreeMap<>(args);
    if (!signatures.add(signature)) throw new AgentPolicy.Stop("NO_PROGRESS");
    c.tool("search".equals(action));
    long started = System.nanoTime();
    var result = tools.call(user, r, action, args, handles);
    if (action.equals("search")) c.retrievalMs += (System.nanoTime() - started) / 1_000_000;
    c.check();
    runs.check(user, id, snapshot);
    if (result.error() != null) {
      step(
          user,
          id,
          snapshot,
          sequence,
          "tool",
          action,
          sanitize(action, args),
          Map.of("error", providerError(result.error())),
          result.usage(),
          started);
      throw new AgentPolicy.Stop(providerError(result.error()));
    }
    int previous = evidence.size();
    for (var e : result.evidence()) tools.verify(user, r, e);
    for (var e : result.evidence())
      if (!evidence.containsKey(e.id())) {
        if (evidence.size() >= r.budget().maxEvidence()
            || evidence.values().stream().mapToInt(x -> x.text().length()).sum() + e.text().length()
                > r.budget().maxEvidenceChars()) {
          c.onExternal.run();
          step(
              user,
              id,
              snapshot,
              sequence,
              "tool",
              action,
              sanitize(action, args),
              Map.of(
                  "error",
                  "BUDGET_EXCEEDED",
                  "acceptedEvidenceIds",
                  List.copyOf(evidence.keySet())),
              result.usage(),
              started);
          throw new AgentPolicy.Stop("BUDGET_EXCEEDED");
        }
        evidence.put(e.id(), e);
        handles.put("E" + (handles.size() + 1), e);
      }
    c.onExternal.run();
    step(
        user,
        id,
        snapshot,
        sequence,
        "tool",
        action,
        sanitize(action, args),
        Map.of("evidenceIds", result.evidence().stream().map(Evidence::id).toList()),
        result.usage(),
        started);
    if (previous > 0 && evidence.size() == previous && !action.equals("inspectCitation"))
      throw new AgentPolicy.Stop("NO_PROGRESS");
    actions.add(
        Map.of(
            "action",
            action,
            "arguments",
            args,
            "returnedHandles",
            handles.entrySet().stream()
                .filter(
                    entry ->
                        result.evidence().stream()
                            .anyMatch(e -> e.id().equals(entry.getValue().id())))
                .map(Map.Entry::getKey)
                .toList()));
  }

  private void step(
      String user,
      String id,
      Object snapshot,
      int[] n,
      String kind,
      String action,
      Object input,
      Object output,
      Object usage,
      long started) {
    var step = new LinkedHashMap<String, Object>();
    step.put("sequence", ++n[0]);
    step.put("kind", kind);
    step.put("action", action);
    step.put(
        "status", output instanceof Map<?, ?> m && m.containsKey("error") ? "FAILED" : "COMPLETED");
    step.put("input", input);
    step.put("output", output);
    step.put("usage", usage);
    step.put("elapsedMs", (System.nanoTime() - started) / 1_000_000);
    step.put("createdAt", java.time.Instant.now().toString());
    runs.step(user, id, snapshot, step);
  }

  private static Object sanitize(String action, Map<String, Object> args) {
    if (action.equals("search")) {
      String q = (String) args.get("query");
      return Map.of(
          "querySha256",
          AuthService.hash(q.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
          "queryChars",
          q.length(),
          "description",
          "检索当前授权知识库");
    }
    return args;
  }

  private Map<String, Object> timedResult(AgentPolicy.Context context, String error) {
    var saved = context.checkpoint.get();
    if (saved == null) return null;
    var result = new LinkedHashMap<String, Object>(saved);
    result.put("error", error);
    result.put("finishReason", error);
    result.put("totalMs", (System.nanoTime() - context.started) / 1_000_000);
    return result;
  }

  private static Map<String, Object> usage(Long prompt, Long completion) {
    var u = new LinkedHashMap<String, Object>();
    u.put("promptTokens", prompt);
    u.put("completionTokens", completion);
    return u;
  }

  private static String providerError(String error) {
    return "OUTPUT_LIMIT".equals(error) ? "OUTPUT_LIMIT" : ProviderFailures.safeCode(error);
  }

  private static List<Evidence> alias(Map<String, Evidence> handles) {
    return handles.entrySet().stream()
        .map(
            entry -> {
              var e = entry.getValue();
              return new Evidence(
                  entry.getKey(),
                  e.documentId(),
                  e.documentName(),
                  e.versionId(),
                  e.page(),
                  e.paragraph(),
                  e.startOffset(),
                  e.endOffset(),
                  e.text(),
                  e.score());
            })
        .toList();
  }
}
