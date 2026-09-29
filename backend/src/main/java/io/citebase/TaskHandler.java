package io.citebase;

import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

public interface TaskHandler {
  TaskKind kind();

  TaskLock publicationLock();

  TaskResult execute(TaskContext context) throws Exception;

  void publish(JdbcTemplate tx, TaskLease lease, TaskResult result);

  void onFailure(JdbcTemplate tx, TaskLease lease, TaskFailure failure, TaskState nextState);

  void validateRetry(JdbcTemplate tx, Map<String, Object> ownedTask);

  void onQueued(JdbcTemplate tx, TaskLease metadata);
}
