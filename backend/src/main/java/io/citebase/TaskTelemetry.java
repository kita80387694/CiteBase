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
                  "citebase.tasks.transitions", "kind", lease.kind().name(), "state", state.name())
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

  public void elapsed(TaskKind kind, TaskState state, long nanos) {
    meters
        .timer("citebase.tasks.execution", "kind", kind.name(), "state", state.name())
        .record(nanos, java.util.concurrent.TimeUnit.NANOSECONDS);
  }
}
