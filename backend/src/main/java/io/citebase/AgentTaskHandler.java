package io.citebase;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Agent steps are auditable, but an interrupted model decision is never silently replayed. */
@Component
public class AgentTaskHandler implements TaskHandler {
  private final AgentService service;
  private final AgentRunRepository runs;
  private final RetrievalService retrieval;

  public AgentTaskHandler(
      AgentService service, AgentRunRepository runs, RetrievalService retrieval) {
    this.service = service;
    this.runs = runs;
    this.retrieval = retrieval;
  }

  public TaskKind kind() {
    return TaskKind.AGENT;
  }

  public TaskLock publicationLock() {
    return TaskLock.SHARED_SOURCE;
  }

  public TaskResult execute(TaskContext context) {
    var lease = context.lease();
    var saved = context.checkpoint("agent-outcome", Map.class);
    if (saved.isPresent()) return outcome(saved.get());
    var view = runs.get(lease.userId(), lease.resourceId());
    if (!"CREATED".equals(view.get("status")) || !context.unknownCalls().isEmpty())
      throw new TaskSignal("UNSAFE_TO_RESUME");
    service.executeLeased(lease.userId(), lease.resourceId());
    var result = context.checkpoint("agent-outcome", Map.class);
    if (result.isEmpty()) {
      var after = runs.get(lease.userId(), lease.resourceId());
      throw new TaskSignal(Objects.toString(after.get("errorCode"), "EXECUTION_ERROR"));
    }
    return outcome(result.get());
  }

  private TaskResult outcome(Map<?, ?> value) {
    if (!"COMPLETED".equals(value.get("status")))
      throw new TaskSignal(Objects.toString(value.get("error"), "EXECUTION_ERROR"));
    return new TaskResult(value);
  }

  public void publish(JdbcTemplate sql, TaskLease lease, TaskResult result) {
    var outcome = (Map<?, ?>) result.result();
    if (!Objects.equals(
        outcome.get("snapshot"), retrieval.dataVersions(lease.userId(), lease.kbId())))
      throw new TaskSignal("SOURCE_CHANGED");
    sql.update(
        "update agent_run set"
            + " status='COMPLETED',error_code=null,result=?::jsonb,finished_at=clock_timestamp()"
            + " where id=? and user_id=?",
        runs.encode(outcome.get("result")),
        lease.resourceId(),
        lease.userId());
  }

  public void onFailure(JdbcTemplate sql, TaskLease lease, TaskFailure failure, TaskState next) {
    if (next == TaskState.CANCEL_REQUESTED) {
      sql.update(
          "update agent_run set status='CANCEL_REQUESTED',cancel_requested_at=clock_timestamp()"
              + " where id=?",
          lease.resourceId());
      return;
    }
    String status = next == TaskState.CANCELLED ? "CANCELLED" : "FAILED";
    Object result = null;
    var checkpoints =
        sql.queryForList(
            "select payload from work_checkpoint where task_id=? and"
                + " checkpoint_key='agent-outcome'",
            lease.taskId());
    if (!checkpoints.isEmpty()) {
      var outcome = (Map<?, ?>) runs.decode(checkpoints.getFirst().get("payload"));
      result = outcome.get("result");
    }
    if (result == null) {
      var partial =
          sql.queryForList(
              "select payload from work_checkpoint where task_id=? and"
                  + " checkpoint_key='agent-partial'",
              lease.taskId());
      if (!partial.isEmpty()) result = runs.decode(partial.getFirst().get("payload"));
    }
    if (result instanceof Map<?, ?> partial) {
      var safe = new LinkedHashMap<String, Object>();
      partial.forEach((k, v) -> safe.put(k.toString(), v));
      var usage = new ArrayList<Map<String, Object>>();
      for (var call :
          sql.queryForList(
              "select call_id,provider,status,usage from work_call where task_id=? order by"
                  + " started_at",
              lease.taskId())) {
        var entry = new LinkedHashMap<String, Object>();
        entry.put(
            "kind", "chat".equals(call.get("provider")) ? "generation" : call.get("provider"));
        entry.put("callId", call.get("call_id"));
        entry.put("status", call.get("status"));
        entry.put(
            "actual",
            "RETURNED".equals(call.get("status")) ? runs.decode(call.get("usage")) : null);
        if (!"RETURNED".equals(call.get("status"))) safe.put("inFlightUsageUnavailable", true);
        usage.add(entry);
      }
      safe.put("usage", usage);
      result = safe;
    }
    if (Set.of("CANCELLED", "SOURCE_CHANGED", "UNSAFE_TO_RESUME").contains(failure.code()))
      result = runs.redacted(result, failure.code());
    sql.update(
        "update agent_run set status=?,error_code=?,result=?::jsonb,finished_at=clock_timestamp()"
            + " where id=? and user_id=?",
        status,
        failure.code(),
        result == null ? null : runs.encode(result),
        lease.resourceId(),
        lease.userId());
  }

  public void validateRetry(JdbcTemplate sql, Map<String, Object> ownedTask) {
    String id = ownedTask.get("id").toString();
    Integer calls =
        sql.queryForObject("select count(*) from work_call where task_id=?", Integer.class, id);
    Integer steps =
        sql.queryForObject("select count(*) from agent_step where run_id=?", Integer.class, id);
    if (calls > 0 || steps > 0)
      throw new ResponseStatusException(HttpStatus.CONFLICT, "为避免重放付费调用，请显式新建运行");
  }

  public void onQueued(JdbcTemplate sql, TaskLease lease) {
    sql.update(
        "delete from work_checkpoint where task_id=? and checkpoint_key in"
            + " ('agent-outcome','agent-partial')",
        lease.taskId());
    sql.update(
        "update agent_run set"
            + " status='CREATED',error_code=null,result=null,started_at=null,finished_at=null,cancel_requested_at=null"
            + " where id=? and user_id=?",
        lease.resourceId(),
        lease.userId());
  }
}
