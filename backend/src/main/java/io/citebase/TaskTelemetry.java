package io.citebase;

import io.micrometer.core.instrument.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.*;

@Component
public final class TaskTelemetry {
  public enum Event {
    ENQUEUED,
    CLAIMED,
    LEASE_RECOVERED,
    HEARTBEAT_LOST,
    DEFERRED,
    RETRY_SCHEDULED,
    CANCEL_REQUESTED,
    TERMINATED,
    FENCE_REJECTED,
    EXTERNAL_OUTCOME_UNKNOWN
  }

  private final MeterRegistry meters;
  private final AtomicInteger active = new AtomicInteger();

  public TaskTelemetry(MeterRegistry meters) {
    this.meters = meters;
    meters.gauge("citebase.tasks.active", active);
  }

  public void active(int delta) {
    active.addAndGet(delta);
  }

  public void event(Event event, TaskLease lease, TaskState state) {
    Runnable emit =
        () -> {
          LoggerFactory.getLogger(TaskTelemetry.class)
              .info(
                  "task_event={} kind={} state={} taskId={} workerId={} fencingToken={} attempt={}",
                  event,
                  lease.kind(),
                  state,
                  lease.taskId(),
                  lease.workerId(),
                  lease.fencingToken(),
                  lease.attempt());
          meters
              .counter(
                  "citebase.tasks.transitions",
                  "kind",
                  lease.kind().name(),
                  "state",
                  state.name(),
                  "event",
                  event.name())
              .increment();
          if (event == Event.FENCE_REJECTED)
            meters
                .counter("citebase.tasks.fence.rejections", "kind", lease.kind().name())
                .increment();
        };
    if (TransactionSynchronizationManager.isSynchronizationActive())
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            public void afterCommit() {
              emit.run();
            }
          });
    else emit.run();
  }

  // Rejection is an attempted write, so it must survive transaction rollback.
  public void rejected(TaskLease lease) {
    meters.counter("citebase.tasks.fence.rejections", "kind", lease.kind().name()).increment();
  }

  private final java.util.concurrent.atomic.AtomicLong nextErrorLog =
      new java.util.concurrent.atomic.AtomicLong();

  public void databaseFailure(String operation) {
    meters.counter("citebase.tasks.database.errors", "operation", operation).increment();
    long now = System.nanoTime(), previous = nextErrorLog.get();
    if (now >= previous
        && nextErrorLog.compareAndSet(
            previous, now + java.util.concurrent.TimeUnit.SECONDS.toNanos(30)))
      LoggerFactory.getLogger(TaskTelemetry.class)
          .warn("task_database_unavailable operation={} retry=bounded_poll", operation);
  }

  public void elapsed(TaskKind kind, String outcome, long nanos) {
    meters
        .timer("citebase.tasks.execution", "kind", kind.name(), "outcome", outcome)
        .record(nanos, java.util.concurrent.TimeUnit.NANOSECONDS);
  }
}
