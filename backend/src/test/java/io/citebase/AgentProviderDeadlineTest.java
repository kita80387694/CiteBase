package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class AgentProviderDeadlineTest {
  @Test
  void ignoredInterruptRetainsAgentCapacityUntilActualProviderEnds() throws Exception {
    var capacity = new Semaphore(2);
    var entered = new CountDownLatch(2);
    var release = new CountDownLatch(1);
    var active = new AtomicInteger();
    var maximum = new AtomicInteger();
    var finished = new CountDownLatch(2);
    for (int i = 0; i < 2; i++) {
      assertTrue(capacity.tryAcquire());
      Thread.ofVirtual()
          .start(
              () -> {
                try {
                  AgentProviderDeadline.call(
                      () -> {
                        maximum.accumulateAndGet(active.incrementAndGet(), Math::max);
                        entered.countDown();
                        while (release.getCount() > 0) {
                          try {
                            release.await();
                          } catch (InterruptedException ignored) {
                            /* hostile HTTP */
                          }
                        }
                        active.decrementAndGet();
                        return "late";
                      },
                      1);
                  fail("Expected deadline failure");
                } catch (Exception expected) {
                  assertTrue(expected instanceof TimeoutException);
                } finally {
                  capacity.release();
                  finished.countDown();
                }
              });
    }
    assertTrue(entered.await(3, TimeUnit.SECONDS));
    try {
      // A new Agent cannot begin its initial embedding while two timed-out planners remain alive.
      assertFalse(capacity.tryAcquire(1600, TimeUnit.MILLISECONDS));
      assertEquals(2, active.get());
      assertEquals(2, maximum.get());
      assertThrows(
          TimeoutException.class,
          () -> AgentProviderDeadline.call(() -> fail("must not start"), 1));
    } finally {
      release.countDown();
    }
    assertTrue(finished.await(3, TimeUnit.SECONDS));
    assertEquals(2, capacity.availablePermits());
    assertEquals(0, active.get());
    assertEquals("next", AgentProviderDeadline.call(() -> "next", 1));
  }
}
