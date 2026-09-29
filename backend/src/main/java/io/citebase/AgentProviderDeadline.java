package io.citebase;

import java.util.concurrent.*;

/** A total call deadline in addition to HTTP connect/read limits; cancellation is best effort. */
final class AgentProviderDeadline {
  // This permit follows the actual HTTP thread, not the caller's timed-out future.
  private static final Semaphore IN_FLIGHT = new Semaphore(2, true);

  static <T> T call(Callable<T> action, int seconds) throws Exception {
    if (seconds < 1 || seconds > 300) throw new IllegalArgumentException("invalid timeout");
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
    if (!IN_FLIGHT.tryAcquire(seconds, TimeUnit.SECONDS)) throw new TimeoutException();
    var result = new CompletableFuture<T>();
    Thread thread;
    try {
      thread =
          Thread.ofVirtual()
              .name("agent-provider")
              .start(
                  () -> {
                    try {
                      result.complete(action.call());
                    } catch (Throwable error) {
                      result.completeExceptionally(error);
                    } finally {
                      IN_FLIGHT.release();
                    }
                  });
    } catch (Throwable error) {
      IN_FLIGHT.release();
      throw error;
    }
    try {
      long remaining = deadline - System.nanoTime();
      if (remaining <= 0) throw new TimeoutException();
      return result.get(remaining, TimeUnit.NANOSECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw e;
    } finally {
      if (!result.isDone()) thread.interrupt();
      // The Agent service returns its deadline response independently. Its worker must not
      // release capacity while this HTTP operation is still alive (some clients ignore interrupt).
      boolean interrupted = Thread.interrupted();
      while (thread.isAlive()) {
        try {
          thread.join();
        } catch (InterruptedException error) {
          interrupted = true;
          thread.interrupt();
        }
      }
      if (interrupted) Thread.currentThread().interrupt();
    }
  }
}
