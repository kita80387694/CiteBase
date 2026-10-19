package io.citebase;

import java.time.Duration;

public final class TaskDeferred extends RuntimeException {
  private final Duration delay;

  public TaskDeferred(Duration delay) {
    super("TASK_DEFERRED");
    this.delay = delay;
  }

  public Duration delay() {
    return delay;
  }
}
