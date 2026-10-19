package io.citebase;

import java.time.Duration;
import java.util.*;

public final class TaskContext {
  private static final ThreadLocal<TaskContext> CURRENT = new ThreadLocal<>();
  private final TaskLease lease;
  private final TaskRepository repository;

  TaskContext(TaskLease lease, TaskRepository repository) {
    this.lease = lease;
    this.repository = repository;
  }

  public static TaskContext current() {
    return CURRENT.get();
  }

  public static void bind(TaskContext context) {
    CURRENT.set(context);
  }

  public static void clear() {
    CURRENT.remove();
  }

  public TaskLease lease() {
    return lease;
  }

  public void checkActive() {
    repository.assertActive(lease);
  }

  public boolean cancellationRequested() {
    return repository.cancellationRequested(lease);
  }

  public <T> Optional<T> checkpoint(String key, Class<T> type) {
    return repository.checkpoint(lease, key, type);
  }

  public void checkpoint(String key, Object value) {
    repository.checkpoint(lease, key, value);
  }

  public TaskCall beginExternalCall(String operationKey, String provider, String requestHash) {
    return repository.beginExternalCall(lease, operationKey, provider, requestHash);
  }

  public void completeExternalCall(TaskCall call, Object validatedResponse, Object actualUsage) {
    repository.completeExternalCall(lease, call, validatedResponse, actualUsage);
  }

  public Optional<Map<String, Object>> completedCall(String operationKey) {
    return repository.completedCall(lease, operationKey);
  }

  public List<Map<String, Object>> unknownCalls() {
    return repository.unknownCalls(lease);
  }

  public void progress(Object progress) {
    repository.progress(lease, progress);
  }

  public void defer(Duration delay) {
    checkActive();
    if (delay.isNegative() || delay.compareTo(Duration.ofHours(24)) > 0)
      throw new IllegalArgumentException("Invalid defer duration");
    throw new TaskDeferred(delay);
  }

  public Duration remainingLease() {
    return repository.remainingLease(lease);
  }
}
