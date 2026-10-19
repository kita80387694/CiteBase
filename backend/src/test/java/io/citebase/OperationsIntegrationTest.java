package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.server.ResponseStatusException;

class OperationsIntegrationTest extends TaskIntegrationTest {
  @Autowired OperationsService operations;

  @Test
  void selfAggregationFiltersBeforeCountingAndPreservesUnknownUsage() {
    String id = upload("ops.md", "operational content");
    var lease = claim("ops-worker");
    var call = tasks.beginExternalCall(lease, "test", "fault-test-only", "hash");
    tasks.completeExternalCall(lease, call, null, Map.of());
    var aliceView = operations.summary(alice, 60);
    var aliceCalls = (Map<?, ?>) aliceView.get("calls");
    assertEquals(1L, ((Number) aliceCalls.get("returned")).longValue());
    assertEquals(0L, ((Number) aliceCalls.get("usageAvailable")).longValue());
    assertEquals(1L, ((Number) aliceCalls.get("usageUnavailable")).longValue());
    var bobView = operations.summary(bob, 60);
    assertEquals(0L, ((Number) ((Map<?, ?>) bobView.get("calls")).get("returned")).longValue());
    for (Object item : (List<?>) bobView.get("kinds")) {
      var row = (Map<?, ?>) item;
      assertEquals(0L, ((Number) row.get("running")).longValue());
      assertNull(((Map<?, ?>) row.get("queueLatency")).get("meanMs"));
    }
    assertFalse(aliceView.toString().contains("operational content"));
    assertFalse(aliceView.toString().contains(id));
  }

  @Test
  void invalidWindowAndMissingOperatorTokenFailClosed() {
    assertEquals(
        400,
        assertThrows(ResponseStatusException.class, () -> operations.summary(alice, 4))
            .getStatusCode()
            .value());
    assertEquals(
        400,
        assertThrows(ResponseStatusException.class, () -> operations.summary(alice, 1441))
            .getStatusCode()
            .value());
    assertEquals(
        404,
        assertThrows(ResponseStatusException.class, () -> operations.local(null))
            .getStatusCode()
            .value());
    assertEquals(
        404,
        assertThrows(ResponseStatusException.class, () -> operations.local("wrong"))
            .getStatusCode()
            .value());
  }

  @Test
  void leaseRecoveryPersistsEventsAndFenceCounterSurvivesRollback() {
    String id = upload("recovery.md", "recovery");
    var first = claim("old");
    tasks.beginExternalCall(first, "test", "fault-test-only", "hash");
    expire(id);
    claim("new");
    assertThrows(TaskSignal.class, () -> tasks.progress(first, Map.of("unsafe", true)));
    var events = (List<?>) operations.summary(alice, 60).get("events");
    assertTrue(
        events.stream().anyMatch(o -> "LEASE_RECOVERED".equals(((Map<?, ?>) o).get("event"))));
    assertTrue(
        events.stream()
            .anyMatch(o -> "EXTERNAL_OUTCOME_UNKNOWN".equals(((Map<?, ?>) o).get("event"))));
    assertEquals(
        1L,
        ((Number) ((Map<?, ?>) operations.summary(alice, 60).get("calls")).get("unknown"))
            .longValue());
  }
}
