package io.citebase;

import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TaskWorker {
  private final TaskRepository tasks;
  private final TaskRegistry registry;
  private final TaskSettings settings;
  private final TaskTelemetry telemetry;
  private final String workerId = UUID.randomUUID().toString();
  private final Semaphore permits;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final ScheduledExecutorService hearts = Executors.newScheduledThreadPool(1);
  private volatile boolean closing;

  public TaskWorker(
      TaskRepository tasks, TaskRegistry registry, TaskSettings settings, TaskTelemetry telemetry) {
    this.tasks = tasks;
    this.registry = registry;
    this.settings = settings;
    this.telemetry = telemetry;
    this.permits = new Semaphore(settings.concurrency());
  }

  public String workerId() {
    return workerId;
  }

  @Scheduled(fixedDelayString = "${TASK_POLL_MILLIS:500}")
  public void tick() {
    if (!settings.enabled() || closing) return;
    while (permits.tryAcquire()) {
      Optional<TaskLease> next;
      try {
        next = tasks.claim(workerId, registry.kinds());
      } catch (RuntimeException e) {
        permits.release();
        throw e;
      }
      if (next.isEmpty()) {
        permits.release();
        return;
      }
      executor.submit(() -> run(next.get()));
    }
  }

  public boolean processOne() {
    return processOne(registry.kinds());
  }

  public boolean processOne(Set<TaskKind> kinds) {
    if (closing || !permits.tryAcquire()) return false;
    Optional<TaskLease> next;
    try {
      next = tasks.claim(workerId, kinds);
    } catch (RuntimeException e) {
      permits.release();
      throw e;
    }
    if (next.isEmpty()) {
      permits.release();
      return false;
    }
    run(next.get());
    return true;
  }

  private void run(TaskLease lease) {
    long started = System.nanoTime();
    Thread thread = Thread.currentThread();
    telemetry.active(1);
    var heartbeat =
        hearts.scheduleAtFixedRate(
            () -> {
              try {
                if (!tasks.heartbeat(lease)) {
                  telemetry.event(TaskTelemetry.Event.HEARTBEAT_LOST, lease, TaskState.FAILED);
                  thread.interrupt();
                }
              } catch (RuntimeException e) {
                thread.interrupt();
              }
            },
            settings.heartbeatSeconds(),
            settings.heartbeatSeconds(),
            TimeUnit.SECONDS);
    TaskContext.bind(new TaskContext(lease, tasks));
    TaskState state = TaskState.FAILED;
    try {
      if (!lease.executionAllowed())
        throw new TaskSignal(
            tasks.cancellationRequested(lease) ? "CANCELLED" : "ATTEMPTS_EXHAUSTED");
      TaskResult result = registry.require(lease.kind()).execute(TaskContext.current());
      tasks.succeed(lease, result);
      state = TaskState.SUCCEEDED;
    } catch (TaskDeferred deferred) {
      try {
        tasks.defer(lease, deferred.delay());
        state = TaskState.QUEUED;
      } catch (TaskSignal ignored) {
      }
    } catch (Exception e) {
      String code =
          e instanceof TaskSignal signal
              ? signal.code()
              : e instanceof SpringAiGateway.ModelFailure
                  ? ProviderFailures.code(e)
                  : "EXECUTION_ERROR";
      if (!Set.of("LEASE_LOST", "DELETED").contains(code)) {
        boolean retry =
            !(e instanceof TaskSignal)
                && (!code.startsWith("PROVIDER_") || ProviderFailures.retryable(code));
        try {
          tasks.fail(
              lease, new TaskFailure(code, retry ? "执行失败，可在有限预算内重试" : "任务停止：" + code, retry, true));
        } catch (TaskSignal ignored) {
        }
      }
    } finally {
      heartbeat.cancel(false);
      TaskContext.clear();
      telemetry.elapsed(lease.kind(), state, System.nanoTime() - started);
      telemetry.active(-1);
      permits.release();
      Thread.interrupted();
    }
  }

  @PreDestroy
  public void close() {
    closing = true;
    executor.shutdown();
    hearts.shutdown();
  }
}
