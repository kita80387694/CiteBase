package io.citebase;

public record TaskLease(
    String taskId,
    TaskKind kind,
    String userId,
    String kbId,
    String resourceId,
    String workerId,
    long fencingToken,
    int attempt,
    boolean executionAllowed,
    Object payload) {
  public TaskLease {
    if (!taskId.equals(resourceId))
      throw new IllegalArgumentException("taskId must equal resourceId");
  }
}
