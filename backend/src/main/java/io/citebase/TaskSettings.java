package io.citebase;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public record TaskSettings(
    boolean enabled,
    int concurrency,
    int leaseSeconds,
    int heartbeatSeconds,
    int maxAttempts,
    int pollMillis,
    int retryDelaySeconds) {
  @org.springframework.beans.factory.annotation.Autowired
  public TaskSettings(Environment env) {
    this(
        env.getProperty("citebase.worker-enabled", Boolean.class, true),
        env.getProperty("TASK_WORKER_CONCURRENCY", Integer.class, 2),
        env.getProperty("TASK_LEASE_SECONDS", Integer.class, 30),
        env.getProperty("TASK_HEARTBEAT_SECONDS", Integer.class, 5),
        env.getProperty("TASK_MAX_ATTEMPTS", Integer.class, 3),
        env.getProperty("TASK_POLL_MILLIS", Integer.class, 500),
        env.getProperty("TASK_RETRY_DELAY_SECONDS", Integer.class, 3));
  }

  public TaskSettings {
    if (concurrency < 1
        || concurrency > 8
        || heartbeatSeconds < 1
        || leaseSeconds < heartbeatSeconds * 3
        || leaseSeconds > 3600
        || maxAttempts < 1
        || maxAttempts > 10
        || pollMillis < 50
        || retryDelaySeconds < 0)
      throw new IllegalArgumentException("Invalid task worker settings");
  }
}
