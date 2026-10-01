package io.citebase;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.*;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TaskRepository {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final ObjectMapper json;
  private final AccessService access;
  private final TaskRegistry registry;
  private final TaskSettings settings;
  private final TaskTelemetry telemetry;

  public TaskRepository(
      JdbcTemplate db,
      TransactionTemplate tx,
      ObjectMapper json,
      AccessService access,
      TaskRegistry registry,
      TaskSettings settings,
      TaskTelemetry telemetry) {
    this.db = db;
    this.tx = tx;
    this.json = json;
    this.access = access;
    this.registry = registry;
    this.settings = settings;
    this.telemetry = telemetry;
  }

  private void event(TaskTelemetry.Event event, TaskLease lease, TaskState state) {
    db.update(
        "insert into work_task_event(task_id,event) values(?,?)", lease.taskId(), event.name());
    telemetry.event(event, lease, state);
  }

  String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid task payload", e);
    }
  }

  Object decode(Object value) {
    if (value == null) return null;
    try {
      return json.readValue(value.toString(), Object.class);
    } catch (Exception e) {
      throw new IllegalStateException("Invalid persisted task JSON", e);
    }
  }

  private void kb(String id, TaskLock lock) {
    db.queryForObject(
        "select pg_advisory_xact_lock"
            + (lock == TaskLock.SHARED_SOURCE ? "_shared" : "")
            + "(hashtextextended(?,0))",
        Object.class,
        id);
  }

  public Optional<Map<String, Object>> findExisting(
      String user, TaskKind kind, String key, String hash) {
    return tx.execute(
        s -> {
          db.queryForObject(
              "select pg_advisory_xact_lock(hashtextextended(?,7))",
              Object.class,
              user + ":" + kind + ":" + key);
          var rows =
              db.queryForList(
                  "select * from work_task where user_id=? and kind=? and idempotency_key=?",
                  user,
                  kind.name(),
                  key);
          if (rows.isEmpty()) return Optional.empty();
          if (!hash.equals(rows.getFirst().get("request_hash"))) throw conflict("幂等键对应的请求不同");
          return Optional.of(view(rows.getFirst()));
        });
  }

  public String enqueue(TaskSpec spec) {
    return tx.execute(
        s -> {
          kb(spec.kbId(), TaskLock.SHARED_SOURCE);
          access.requireKnowledgeBase(spec.userId(), spec.kbId());
          String payload = encode(spec.payload());
          var existing =
              findExisting(
                  spec.userId(),
                  spec.kind(),
                  spec.idempotencyKey(),
                  AuthService.hash(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
          if (existing.isPresent()) return existing.get().get("id").toString();
          db.update(
              "insert into"
                  + " work_task(id,kind,user_id,kb_id,idempotency_key,request_hash,payload,status,max_attempts)"
                  + " values(?,?,?,?,?,?,?::jsonb,'QUEUED',?)",
              spec.resourceId(),
              spec.kind().name(),
              spec.userId(),
              spec.kbId(),
              spec.idempotencyKey(),
              AuthService.hash(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
              payload,
              spec.maxAttempts());
          var lease = metadata(row(spec.resourceId()), false);
          registry.require(spec.kind()).onQueued(db, lease);
          event(TaskTelemetry.Event.ENQUEUED, lease, TaskState.QUEUED);
          return spec.resourceId();
        });
  }

  private Map<String, Object> row(String id) {
    var rows =
        db.queryForList(
            "select *,lease_until>clock_timestamp() as lease_valid from work_task where id=?", id);
    if (rows.isEmpty()) throw new TaskSignal("DELETED");
    return rows.getFirst();
  }

  private TaskLease metadata(Map<String, Object> r, boolean allowed) {
    String id = r.get("id").toString();
    return new TaskLease(
        id,
        TaskKind.valueOf(r.get("kind").toString()),
        r.get("user_id").toString(),
        r.get("kb_id").toString(),
        id,
        (String) r.get("lease_owner"),
        ((Number) r.get("fencing_token")).longValue(),
        ((Number) r.get("attempts")).intValue(),
        allowed,
        decode(r.get("payload")));
  }

  public Optional<TaskLease> claim(String worker, Set<TaskKind> kinds) {
    if (kinds.isEmpty()) return Optional.empty();
    return tx.execute(
        s -> {
          String marks = String.join(",", Collections.nCopies(kinds.size(), "?"));
          var rows =
              db.queryForList(
                  "select * from work_task where kind in ("
                      + marks
                      + ") and ((status in ('QUEUED','RETRY_WAIT') and"
                      + " available_at<=clock_timestamp()) or (status in"
                      + " ('RUNNING','CANCEL_REQUESTED') and lease_until<=clock_timestamp())) order"
                      + " by available_at,created_at,id for update skip locked limit 1",
                  kinds.stream().map(Enum::name).toArray());
          if (rows.isEmpty()) return Optional.empty();
          var r = rows.getFirst();
          boolean cancelled = "CANCEL_REQUESTED".equals(r.get("status"));
          boolean resume = Boolean.TRUE.equals(r.get("resume_without_attempt"));
          boolean allowed =
              !cancelled
                  && (resume
                      || ((Number) r.get("attempts")).intValue()
                          < ((Number) r.get("max_attempts")).intValue());
          String id = r.get("id").toString();
          int unknownCalls =
              db.update(
                  "update work_call set"
                      + " status='UNKNOWN',outcome='PROCESS_INTERRUPTED',finished_at=clock_timestamp(),response=null"
                      + " where task_id=? and status='STARTED'",
                  id);
          db.update(
              "update work_task set"
                  + " status=?,lease_owner=?,lease_until=clock_timestamp()+make_interval(secs=>?),last_heartbeat_at=clock_timestamp(),fencing_token=fencing_token+1,attempts=attempts+?,resume_without_attempt=false,started_at=coalesce(started_at,clock_timestamp())"
                  + " where id=?",
              cancelled ? "CANCEL_REQUESTED" : "RUNNING",
              worker,
              settings.leaseSeconds(),
              allowed && !resume ? 1 : 0,
              id);
          var lease = metadata(row(id), allowed);
          if (Set.of("RUNNING", "CANCEL_REQUESTED").contains(r.get("status")))
            event(TaskTelemetry.Event.LEASE_RECOVERED, lease, TaskState.RUNNING);
          if (unknownCalls > 0)
            event(TaskTelemetry.Event.EXTERNAL_OUTCOME_UNKNOWN, lease, TaskState.RUNNING);
          event(
              TaskTelemetry.Event.CLAIMED,
              lease,
              cancelled ? TaskState.CANCEL_REQUESTED : TaskState.RUNNING);
          return Optional.of(lease);
        });
  }

  public boolean heartbeat(TaskLease l) {
    return db.update(
            "update work_task set"
                + " lease_until=clock_timestamp()+make_interval(secs=>?),last_heartbeat_at=clock_timestamp()"
                + " where id=? and lease_owner=? and fencing_token=? and status in"
                + " ('RUNNING','CANCEL_REQUESTED') and lease_until>clock_timestamp()",
            settings.leaseSeconds(),
            l.taskId(),
            l.workerId(),
            l.fencingToken())
        == 1;
  }

  private void valid(TaskLease l, Map<String, Object> r, boolean allowCancel) {
    if (!l.userId().equals(r.get("user_id"))
        || !l.kbId().equals(r.get("kb_id"))
        || !l.kind().name().equals(r.get("kind"))
        || l.workerId() == null
        || !Objects.equals(l.workerId(), r.get("lease_owner"))
        || l.fencingToken() != ((Number) r.get("fencing_token")).longValue()
        || !Boolean.TRUE.equals(r.get("lease_valid"))) {
      telemetry.rejected(l);
      throw new TaskSignal("LEASE_LOST");
    }
    String status = r.get("status").toString();
    if (status.equals("CANCEL_REQUESTED")) {
      if (!allowCancel) throw new TaskSignal("CANCELLED");
    } else if (!status.equals("RUNNING")) {
      telemetry.rejected(l);
      throw new TaskSignal("LEASE_LOST");
    }
  }

  public void assertActive(TaskLease l) {
    valid(l, row(l.taskId()), false);
    if (!l.executionAllowed()) throw new TaskSignal("ATTEMPTS_EXHAUSTED");
  }

  public boolean cancellationRequested(TaskLease l) {
    var r = row(l.taskId());
    valid(l, r, true);
    return "CANCEL_REQUESTED".equals(r.get("status"));
  }

  private <T> T guardedInternal(
      TaskLease l, TaskLock lock, boolean cancel, Function<JdbcTemplate, T> action) {
    return tx.execute(
        s -> {
          kb(l.kbId(), lock);
          db.queryForList("select id from work_task where id=? for update", l.taskId());
          valid(l, row(l.taskId()), cancel);
          T result = action.apply(db);
          valid(l, row(l.taskId()), cancel);
          return result;
        });
  }

  public <T> T guarded(TaskLease l, TaskLock lock, Function<JdbcTemplate, T> action) {
    if (!l.executionAllowed()) throw new TaskSignal("ATTEMPTS_EXHAUSTED");
    return guardedInternal(l, lock, false, action);
  }

  public Duration remainingLease(TaskLease l) {
    assertActive(l);
    Double seconds =
        db.queryForObject(
            "select greatest(0,extract(epoch from lease_until-clock_timestamp()))::float8 from"
                + " work_task where id=?",
            Double.class,
            l.taskId());
    return Duration.ofMillis((long) (seconds * 1000));
  }

  public <T> Optional<T> checkpoint(TaskLease l, String key, Class<T> type) {
    assertActive(l);
    var rows =
        db.queryForList(
            "select payload from work_checkpoint where task_id=? and checkpoint_key=?",
            l.taskId(),
            key);
    if (rows.isEmpty()) return Optional.empty();
    return Optional.of(json.convertValue(decode(rows.getFirst().get("payload")), type));
  }

  public void checkpoint(TaskLease l, String key, Object value) {
    guarded(
        l,
        TaskLock.SHARED_SOURCE,
        d -> {
          d.update(
              "insert into work_checkpoint(task_id,checkpoint_key,payload,fencing_token)"
                  + " values(?,?,?::jsonb,?) on conflict(task_id,checkpoint_key) do update set"
                  + " payload=excluded.payload,fencing_token=excluded.fencing_token,updated_at=clock_timestamp()",
              l.taskId(),
              key,
              encode(value),
              l.fencingToken());
          return null;
        });
  }

  public void progress(TaskLease l, Object value) {
    guarded(
        l,
        TaskLock.SHARED_SOURCE,
        d -> {
          d.update("update work_task set progress=?::jsonb where id=?", encode(value), l.taskId());
          return null;
        });
  }

  public TaskCall beginExternalCall(TaskLease l, String operation, String provider, String hash) {
    return guarded(
        l,
        TaskLock.SHARED_SOURCE,
        d -> {
          String id = UUID.randomUUID().toString();
          d.update(
              "insert into"
                  + " work_call(task_id,call_id,operation_key,fencing_token,provider,request_hash,status)"
                  + " values(?,?,?,?,?,?,'STARTED')",
              l.taskId(),
              id,
              operation,
              l.fencingToken(),
              provider,
              hash);
          return new TaskCall(id, operation, l.fencingToken());
        });
  }

  public void completeExternalCall(TaskLease l, TaskCall call, Object response, Object usage) {
    guardedInternal(
        l,
        TaskLock.SHARED_SOURCE,
        true,
        d -> {
          boolean cancel = "CANCEL_REQUESTED".equals(row(l.taskId()).get("status"));
          if (call.fencingToken() != l.fencingToken()) throw new TaskSignal("LEASE_LOST");
          int n =
              d.update(
                  "update work_call set"
                      + " status='RETURNED',response=?::jsonb,usage=?::jsonb,outcome=?,finished_at=clock_timestamp()"
                      + " where task_id=? and call_id=? and fencing_token=? and status='STARTED'",
                  cancel || response == null ? null : encode(response),
                  usage == null ? null : encode(usage),
                  cancel ? "RETURNED_AFTER_CANCEL" : "RETURNED",
                  l.taskId(),
                  call.callId(),
                  l.fencingToken());
          if (n != 1) throw new TaskSignal("CALL_STATE_CHANGED");
          return null;
        });
  }

  public Optional<Map<String, Object>> completedCall(TaskLease l, String key) {
    assertActive(l);
    var rows =
        db.queryForList(
            "select call_id,response,usage from work_call where task_id=? and operation_key=? and"
                + " status='RETURNED' and response is not null order by started_at desc limit 1",
            l.taskId(),
            key);
    return rows.stream()
        .findFirst()
        .map(
            r -> {
              r.put("response", decode(r.get("response")));
              r.put("usage", decode(r.get("usage")));
              return r;
            });
  }

  public List<Map<String, Object>> unknownCalls(TaskLease l) {
    assertActive(l);
    return db.queryForList(
        "select call_id,operation_key,provider,status,started_at,finished_at from work_call where"
            + " task_id=? and status='UNKNOWN' order by started_at",
        l.taskId());
  }

  private static ResponseStatusException conflict(String text) {
    return new ResponseStatusException(HttpStatus.CONFLICT, text);
  }

  public void succeed(TaskLease l, TaskResult result) {
    TaskHandler h = registry.require(l.kind());
    tx.executeWithoutResult(
        s -> {
          kb(l.kbId(), h.publicationLock());
          db.queryForList("select id from work_task where id=? for update", l.taskId());
          valid(l, row(l.taskId()), false);
          h.publish(db, l, result);
          valid(l, row(l.taskId()), false);
          terminal(l, TaskState.SUCCEEDED, null);
        });
  }

  private void terminal(TaskLease l, TaskState state, TaskFailure failure) {
    db.update(
        "update work_task set"
            + " status=?,error_code=?,error_summary=?,finished_at=clock_timestamp(),lease_owner=null,lease_until=null,resume_without_attempt=false"
            + " where id=? and fencing_token=?",
        state.name(),
        failure == null ? null : failure.code(),
        failure == null ? null : failure.safeMessage(),
        l.taskId(),
        l.fencingToken());
    event(TaskTelemetry.Event.TERMINATED, l, state);
  }

  public TaskState fail(TaskLease l, TaskFailure failure) {
    TaskHandler h = registry.require(l.kind());
    return tx.execute(
        s -> {
          kb(l.kbId(), h.publicationLock());
          db.queryForList("select id from work_task where id=? for update", l.taskId());
          var r = row(l.taskId());
          valid(l, r, true);
          boolean cancel = "CANCEL_REQUESTED".equals(r.get("status"));
          TaskState next =
              cancel
                  ? TaskState.CANCELLED
                  : failure.retryable() && l.attempt() < ((Number) r.get("max_attempts")).intValue()
                      ? TaskState.RETRY_WAIT
                      : TaskState.FAILED;
          TaskFailure actual =
              cancel
                  ? new TaskFailure("CANCELLED", "任务已取消", false, failure.externalOutcomeUnknown())
                  : failure;
          h.onFailure(db, l, actual, next);
          valid(l, row(l.taskId()), true);
          int unknownCalls =
              db.update(
                  "update work_call set"
                      + " status='UNKNOWN',outcome='EXECUTION_INTERRUPTED',response=null,finished_at=clock_timestamp()"
                      + " where task_id=? and status='STARTED'",
                  l.taskId());
          if (unknownCalls > 0) event(TaskTelemetry.Event.EXTERNAL_OUTCOME_UNKNOWN, l, next);
          if (next == TaskState.RETRY_WAIT) {
            db.update(
                "update work_task set"
                    + " status='RETRY_WAIT',error_code=?,error_summary=?,available_at=clock_timestamp()+make_interval(secs=>?),lease_owner=null,lease_until=null,resume_without_attempt=false"
                    + " where id=?",
                actual.code(),
                actual.safeMessage(),
                settings.retryDelaySeconds(),
                l.taskId());
            event(TaskTelemetry.Event.RETRY_SCHEDULED, l, next);
          } else terminal(l, next, actual);
          return next;
        });
  }

  public void defer(TaskLease l, Duration delay) {
    tx.executeWithoutResult(
        s -> {
          kb(l.kbId(), TaskLock.SHARED_SOURCE);
          db.queryForList("select id from work_task where id=? for update", l.taskId());
          valid(l, row(l.taskId()), false);
          db.update(
              "update work_task set"
                  + " status='QUEUED',available_at=clock_timestamp()+make_interval(secs=>?),resume_without_attempt=true,lease_owner=null,lease_until=null"
                  + " where id=?",
              delay.toMillis() / 1000.0,
              l.taskId());
          event(TaskTelemetry.Event.DEFERRED, l, TaskState.QUEUED);
        });
  }

  public Map<String, Object> get(String user, String id) {
    var rows = db.queryForList("select * from work_task where id=? and user_id=?", id, user);
    if (rows.isEmpty()) throw AccessService.missing();
    var result = view(rows.getFirst());
    var calls =
        db.queryForList(
            "select call_id as \"callId\",operation_key as \"operationKey\",fencing_token as"
                + " \"fencingToken\",provider,status,outcome,usage,started_at as"
                + " \"startedAt\",finished_at as \"finishedAt\" from work_call where task_id=?"
                + " order by started_at,call_id",
            id);
    for (var call : calls) {
      call.put("usage", decode(call.get("usage")));
      for (String time : List.of("startedAt", "finishedAt")) {
        Object value = call.get(time);
        if (value instanceof java.sql.Timestamp timestamp)
          call.put(time, timestamp.toInstant().toString());
      }
    }
    result.put("externalCalls", calls);
    return result;
  }

  public List<Map<String, Object>> list(String user, String kbId) {
    return list(user, kbId, null);
  }

  public List<Map<String, Object>> list(String user, String kbId, TaskKind kind) {
    if (kbId != null) access.requireKnowledgeBase(user, kbId);
    String sql = "select * from work_task where user_id=?";
    List<Object> params = new ArrayList<>();
    params.add(user);
    if (kbId != null) {
      sql += " and kb_id=?";
      params.add(kbId);
    }
    if (kind != null) {
      sql += " and kind=?";
      params.add(kind.name());
    }
    return db
        .queryForList(sql + " order by created_at desc,id limit 500", params.toArray())
        .stream()
        .map(this::view)
        .toList();
  }

  private Map<String, Object> view(Map<String, Object> r) {
    Map<String, Object> v = new LinkedHashMap<>();
    for (String key : List.of("id", "kind", "status", "attempts")) v.put(key, r.get(key));
    v.put("workTaskId", r.get("id"));
    v.put("kbId", r.get("kb_id"));
    v.put("maxAttempts", r.get("max_attempts"));
    v.put("retryGeneration", r.get("retry_generation"));
    v.put("payload", decode(r.get("payload")));
    v.put("progress", decode(r.get("progress")));
    v.put("errorCode", r.get("error_code"));
    v.put("errorSummary", r.get("error_summary"));
    for (String key : List.of("created_at", "started_at", "finished_at", "available_at")) {
      String name = key.substring(0, key.indexOf('_')) + "At";
      Object raw = r.get(key);
      v.put(
          name,
          raw instanceof java.sql.Timestamp t
              ? t.toInstant().toString()
              : raw == null ? null : raw.toString());
    }
    String status = r.get("status").toString();
    v.put("canCancel", Set.of("QUEUED", "RETRY_WAIT", "RUNNING").contains(status));
    boolean retry = Set.of("FAILED", "CANCELLED").contains(status);
    String blocked = null;
    if (retry)
      try {
        registry.require(TaskKind.valueOf(r.get("kind").toString())).validateRetry(db, v);
      } catch (RuntimeException e) {
        retry = false;
        blocked = e instanceof ResponseStatusException x ? x.getReason() : "当前业务状态不允许重试";
      }
    v.put("canRetry", retry);
    v.put("retryBlockedReason", blocked);
    if ("INDEX".equals(r.get("kind"))) {
      var docs =
          db.queryForList(
              "select t.document_id,t.version_id,t.status,d.name from index_task t join document d"
                  + " on d.id=t.document_id where t.id=?",
              r.get("id"));
      if (!docs.isEmpty()) {
        var d = docs.getFirst();
        v.put("documentId", d.get("document_id"));
        v.put("versionId", d.get("version_id"));
        v.put("documentName", d.get("name"));
        v.put("legacyStatus", d.get("status"));
      }
    }
    return v;
  }

  private Map<String, Object> ownedLocked(String user, String id) {
    var first = get(user, id);
    kb(first.get("kbId").toString(), TaskLock.SHARED_SOURCE);
    var rows =
        db.queryForList("select * from work_task where id=? and user_id=? for update", id, user);
    if (rows.isEmpty()) throw AccessService.missing();
    return rows.getFirst();
  }

  public Map<String, Object> cancel(String user, String id) {
    return tx.execute(
        s -> {
          var r = ownedLocked(user, id);
          String status = r.get("status").toString();
          var h = registry.require(TaskKind.valueOf(r.get("kind").toString()));
          if (Set.of("QUEUED", "RETRY_WAIT").contains(status)) {
            db.update(
                "update work_task set"
                    + " fencing_token=fencing_token+1,cancel_requested_at=clock_timestamp() where"
                    + " id=?",
                id);
            var l = metadata(row(id), false);
            h.onFailure(
                db, l, new TaskFailure("CANCELLED", "任务已取消", false, false), TaskState.CANCELLED);
            terminal(l, TaskState.CANCELLED, new TaskFailure("CANCELLED", "任务已取消", false, false));
          } else if (status.equals("RUNNING")) {
            db.update(
                "update work_task set"
                    + " status='CANCEL_REQUESTED',cancel_requested_at=clock_timestamp() where id=?",
                id);
            var l = metadata(row(id), false);
            h.onFailure(
                db,
                l,
                new TaskFailure("CANCELLED", "正在取消", false, false),
                TaskState.CANCEL_REQUESTED);
            event(TaskTelemetry.Event.CANCEL_REQUESTED, l, TaskState.CANCEL_REQUESTED);
          }
          return get(user, id);
        });
  }

  public Map<String, Object> retry(String user, String id) {
    return tx.execute(
        s -> {
          var r = ownedLocked(user, id);
          if (!Set.of("FAILED", "CANCELLED").contains(r.get("status")))
            throw conflict("仅失败或已取消任务可重试");
          var h = registry.require(TaskKind.valueOf(r.get("kind").toString()));
          h.validateRetry(db, view(r));
          db.update(
              "update work_task set"
                  + " status='QUEUED',attempts=0,retry_generation=retry_generation+1,fencing_token=fencing_token+1,resume_without_attempt=false,available_at=clock_timestamp(),finished_at=null,cancel_requested_at=null,error_code=null,error_summary=null,lease_owner=null,lease_until=null"
                  + " where id=?",
              id);
          var l = metadata(row(id), false);
          h.onQueued(db, l);
          event(TaskTelemetry.Event.ENQUEUED, l, TaskState.QUEUED);
          return get(user, id);
        });
  }
}
