package io.citebase;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** All API instances sharing a database must use the same task limits. */
@Component
public record AdmissionSettings(int globalTasks, int userTasks, int syncConcurrency, int retryAfterSeconds) {
  @org.springframework.beans.factory.annotation.Autowired
  public AdmissionSettings(Environment env) {
    this(env.getProperty("ADMISSION_GLOBAL_TASKS", Integer.class, 256),
        env.getProperty("ADMISSION_USER_TASKS", Integer.class, 64),
        env.getProperty("ADMISSION_SYNC_CONCURRENCY", Integer.class, 4),
        env.getProperty("ADMISSION_RETRY_AFTER_SECONDS", Integer.class, 3));
  }

  public AdmissionSettings {
    if (globalTasks < 1 || globalTasks > 100000 || userTasks < 1 || userTasks > globalTasks
        || syncConcurrency < 1 || syncConcurrency > 64 || retryAfterSeconds < 1 || retryAfterSeconds > 300)
      throw new IllegalArgumentException("Invalid admission settings");
  }
}
