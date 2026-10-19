package io.citebase;

import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Component
public class AdmissionService {
  private final AdmissionSettings settings;
  private final JdbcTemplate db;
  private final AccessService access;
  private final Semaphore synchronous;

  public AdmissionService(AdmissionSettings settings, JdbcTemplate db, AccessService access) {
    this.settings = settings;
    this.db = db;
    this.access = access;
    synchronous = new Semaphore(settings.syncConcurrency());
  }

  /** Call only for an additional nonterminal task, inside its creation/retry transaction. */
  void admitTask(String user) {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("Task admission requires the task transaction");
    // One database-wide transaction lock serializes admissions across API processes and users.
    // Claims/retries within the nonterminal set do not add slots; terminal transitions free slots.
    db.queryForObject("select pg_advisory_xact_lock(1128879173, 31)", Object.class);
    var counts = db.queryForMap(
        "select count(*) as total, count(*) filter(where user_id=?) as owned from work_task"
            + " where status in ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED')", user);
    if (((Number) counts.get("total")).longValue() >= settings.globalTasks()
        || ((Number) counts.get("owned")).longValue() >= settings.userTasks())
      throw new AdmissionRejected(settings.retryAfterSeconds());
  }

  /** Authenticated synchronous HTTP work only; this is a per-JVM bound, not a cluster quota. */
  <T> T synchronous(String user, String kb, Supplier<T> action) {
    access.requireKnowledgeBase(user, kb);
    if (!synchronous.tryAcquire()) throw new AdmissionRejected(settings.retryAfterSeconds());
    try {
      return action.get();
    } finally {
      synchronous.release();
    }
  }
}
