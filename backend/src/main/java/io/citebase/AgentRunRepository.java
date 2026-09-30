package io.citebase;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AgentRunRepository {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final AccessService access;
  private final RetrievalService retrieval;
  private final QuestionService questions;
  private final ObjectMapper json;
  private final AgentPlannerGateway planner;
  private final TaskRepository tasks;
  private final int taskMaxAttempts;

  public AgentRunRepository(
      JdbcTemplate db,
      org.springframework.transaction.PlatformTransactionManager tm,
      AccessService access,
      RetrievalService retrieval,
      QuestionService questions,
      ObjectMapper json,
      AgentPlannerGateway planner,
      TaskRepository tasks,
      @org.springframework.beans.factory.annotation.Value("${AGENT_TASK_MAX_ATTEMPTS:2}")
          int taskMaxAttempts) {
    this.db = db;
    this.tx = new TransactionTemplate(tm);
    this.access = access;
    this.retrieval = retrieval;
    this.questions = questions;
    this.json = json;
    this.planner = planner;
    this.tasks = tasks;
    if (taskMaxAttempts < 1 || taskMaxAttempts > 10)
      throw new IllegalArgumentException("AGENT_TASK_MAX_ATTEMPTS must be 1..10");
    this.taskMaxAttempts = taskMaxAttempts;
  }

  String encode(Object x) {
    try {
      return json.writeValueAsString(x);
    } catch (Exception e) {
      throw new IllegalArgumentException(e);
    }
  }

  private String encodeRequest(AgentInput.Request request) {
    var value =
        json.convertValue(
            request,
            new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() {});
    if ("original".equals(request.strategy())) value.remove("strategy");
    return encode(value);
  }

  Object decode(Object x) {
    try {
      return x == null ? null : json.readValue(x.toString(), Object.class);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public Map<String, Object> create(String user, AgentInput.Request request) {
    return tx.execute(
        s -> {
          lock(request.kbId());
          access.requireKnowledgeBase(user, request.kbId());
          String body = encodeRequest(request),
              hash = AuthService.hash(body.getBytes(StandardCharsets.UTF_8)),
              id = UUID.randomUUID().toString();
          var config = configuration(request);
          db.update(
              "insert into"
                  + " agent_run(id,user_id,kb_id,idempotency_key,request_hash,status,request,config,snapshot)"
                  + " values(?,?,?,?,?,'CREATED',?::jsonb,?::jsonb,?::jsonb) on"
                  + " conflict(user_id,idempotency_key) do nothing",
              id,
              user,
              request.kbId(),
              request.idempotencyKey(),
              hash,
              body,
              encode(config),
              encode(retrieval.dataVersions(user, request.kbId())));
          var existing =
              db.queryForMap(
                  "select id,request_hash from agent_run where user_id=? and idempotency_key=?",
                  user,
                  request.idempotencyKey());
          if (!hash.equals(existing.get("request_hash")))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等key已用于不同请求");
          return get(user, (String) existing.get("id"));
        });
  }

  public Map<String, Object> get(String user, String id) {
    var rows =
        db.queryForList(
            "select"
                + " id,kb_id,status,request,config,snapshot,result,error_code,created_at,started_at,finished_at,cancel_requested_at"
                + " from agent_run where id=? and user_id=?",
            id,
            user);
    if (rows.isEmpty()) throw AccessService.missing();
    var r = rows.getFirst();
    var out = new LinkedHashMap<String, Object>();
    out.put("id", r.get("id"));
    out.put("kbId", r.get("kb_id"));
    out.put("status", r.get("status"));
    for (String key : List.of("request", "config", "snapshot", "result"))
      out.put(key, decode(r.get(key)));
    out.put("errorCode", r.get("error_code"));
    for (var pair :
        Map.of(
                "createdAt",
                "created_at",
                "startedAt",
                "started_at",
                "finishedAt",
                "finished_at",
                "cancelRequestedAt",
                "cancel_requested_at")
            .entrySet())
      out.put(
          pair.getKey(),
          r.get(pair.getValue()) == null
              ? null
              : r.get(pair.getValue()) instanceof java.sql.Timestamp timestamp
                  ? timestamp.toInstant().toString()
                  : r.get(pair.getValue()).toString());
    out.put(
        "steps",
        db.query(
            "select payload from agent_step where run_id=? order by sequence",
            (rs, n) -> decode(rs.getString(1)),
            id));
    var taskRows = db.queryForList("select id from work_task where id=? and user_id=?", id, user);
    if (!taskRows.isEmpty()) {
      var task = tasks.get(user, id);
      out.put("taskId", id);
      for (String key : List.of("progress", "canRetry", "retryBlockedReason"))
        out.put(key, task.get(key));
      out.put("taskStatus", task.get("status"));
    }
    return out;
  }

  public Map<String, Object> enqueue(String user, String id) {
    return tx.execute(
        s -> {
          var view = get(user, id);
          exclusive((String) view.get("kbId"));
          db.queryForList("select id from agent_run where id=? and user_id=? for update", id, user);
          view = get(user, id);
          if (view.containsKey("taskId") || !"CREATED".equals(view.get("status"))) return view;
          tasks.enqueue(
              new TaskSpec(
                  TaskKind.AGENT,
                  user,
                  (String) view.get("kbId"),
                  id,
                  "agent:" + id,
                  Map.of("runId", id),
                  taskMaxAttempts));
          return get(user, id);
        });
  }

  public List<Map<String, Object>> list(String user, String kb) {
    access.requireKnowledgeBase(user, kb);
    return db
        .queryForList(
            "select id from agent_run where user_id=? and kb_id=? order by created_at desc limit"
                + " 100",
            String.class,
            user,
            kb)
        .stream()
        .map(id -> get(user, id))
        .toList();
  }

  public AgentInput.Request request(Map<String, Object> view) {
    return json.convertValue(view.get("request"), AgentInput.Request.class);
  }

  public boolean claim(String user, String id) {
    var context = bound(user, id);
    return tasks.guarded(context.lease(), TaskLock.SHARED_SOURCE, sql -> claimOwned(user, id));
  }

  private boolean claimOwned(String user, String id) {
    return tx.execute(
        s -> {
          var view = get(user, id);
          lock((String) view.get("kbId"));
          var states =
              db.queryForList(
                  "select status from agent_run where id=? and user_id=? for update",
                  String.class,
                  id,
                  user);
          if (states.isEmpty()) throw AccessService.missing();
          if (!states.getFirst().equals("CREATED")) return false;
          view = get(user, id);
          // JSON normalization compares record-valued options with persisted JSON maps without
          // secrets.
          if (!Objects.equals(view.get("config"), decode(encode(configuration(request(view)))))) {
            db.update(
                "update agent_run set status='FAILED',error_code='CONFIG_CHANGED',finished_at=now()"
                    + " where id=? and user_id=? and status='CREATED'",
                id,
                user);
            return false;
          }
          return db.update(
                  "update agent_run set status='RUNNING',started_at=now() where id=? and user_id=?"
                      + " and status='CREATED'",
                  id,
                  user)
              == 1;
        });
  }

  private Map<String, Object> configuration(AgentInput.Request request) {
    var config = questions.config(request.topK(), request.retrievalOptions());
    config.put("agentPolicyVersion", "bounded-agent-v1");
    if (!"original".equals(request.strategy())) {
      config.put("agentStrategy", request.strategy());
      config.put("agentStrategyProtocol", "bounded-actions-v1");
    }
    config.put("concurrency", 2);
    config.put("agentPlanner", planner.configuration());
    return config;
  }

  public Map<String, Object> cancel(String user, String id) {
    return tx.execute(
        s -> {
          var before = get(user, id);
          exclusive((String) before.get("kbId"));
          var owned = get(user, id);
          if (owned.containsKey("taskId")) {
            tasks.cancel(user, id);
            return get(user, id);
          }
          db.update(
              "update agent_run set"
                  + " cancel_requested_at=clock_timestamp(),status='CANCELLED',finished_at=clock_timestamp()"
                  + " where id=? and user_id=? and status='CREATED'",
              id,
              user);
          return get(user, id);
        });
  }

  private void exclusive(String kb) {
    db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", kb);
  }

  public void check(String user, String id, Object snapshot) {
    bound(user, id).checkActive();
    var view = get(user, id);
    if (!"RUNNING".equals(view.get("status"))) throw new AgentPolicy.Stop("CANCELLED");
    if (!Objects.equals(snapshot, retrieval.dataVersions(user, (String) view.get("kbId"))))
      throw new AgentPolicy.Stop("SOURCE_CHANGED");
  }

  private void lock(String kb) {
    db.queryForList("select pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
  }

  private TaskContext bound(String user, String id) {
    var context = TaskContext.current();
    if (context == null) throw new TaskSignal("LEASE_REQUIRED");
    var lease = context.lease();
    if (lease.kind() != TaskKind.AGENT
        || !lease.resourceId().equals(id)
        || !lease.userId().equals(user)) throw new TaskSignal("LEASE_IDENTITY_MISMATCH");
    var view = get(user, id);
    if (!lease.kbId().equals(view.get("kbId"))) throw new TaskSignal("LEASE_IDENTITY_MISMATCH");
    return context;
  }

  public void step(String user, String id, Object snapshot, Map<String, Object> step) {
    var context = bound(user, id);
    tasks.guarded(
        context.lease(),
        TaskLock.SHARED_SOURCE,
        sql -> {
          check(user, id, snapshot);
          sql.update(
              "insert into agent_step(run_id,sequence,payload) values(?,?,?::jsonb)",
              id,
              step.get("sequence"),
              encode(step));
          return null;
        });
  }

  public void finish(
      String user, String id, Object snapshot, String status, String error, Object result) {
    var lease = bound(user, id).lease();
    var outcome = new LinkedHashMap<String, Object>();
    outcome.put("status", status);
    outcome.put("error", error);
    outcome.put("result", result);
    outcome.put("snapshot", snapshot);
    tasks.guarded(
        lease,
        TaskLock.SHARED_SOURCE,
        sql -> {
          if (!Objects.equals(snapshot, retrieval.dataVersions(user, lease.kbId()))) {
            outcome.put("status", "FAILED");
            outcome.put("error", "SOURCE_CHANGED");
            outcome.put("result", redacted(result, "SOURCE_CHANGED"));
          }
          sql.update(
              "insert into work_checkpoint(task_id,checkpoint_key,payload,fencing_token)"
                  + " values(?,'agent-outcome',?::jsonb,?) on conflict(task_id,checkpoint_key) do"
                  + " nothing",
              lease.taskId(),
              encode(outcome),
              lease.fencingToken());
          return null;
        });
  }

  Object redacted(Object result, String code) {
    if (!(result instanceof Map<?, ?> original)) return null;
    var safe = new LinkedHashMap<String, Object>();
    for (String field :
        List.of(
            "kind",
            "mode",
            "modelMode",
            "retrievalOptions",
            "totalMs",
            "retrievalMs",
            "budgetUsed",
            "usage",
            "inFlightUsageUnavailable",
            "answerCorrect")) if (original.containsKey(field)) safe.put(field, original.get(field));
    safe.put("answer", "");
    safe.put("evidence", List.of());
    safe.put("citations", List.of());
    safe.put("citationValid", false);
    safe.put("abstained", true);
    safe.put("error", code);
    safe.put("finishReason", code);
    return safe;
  }
}
