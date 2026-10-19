package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class RetrievalCostUnitTest {
  Evidence e(String id, String doc, String text) {
    return new Evidence(id, doc, doc, "v", 1, 1, 0, text.length(), text, 1);
  }

  RetrievalOutcome outcome(String error) {
    var diagnostics = new LinkedHashMap<String, Object>();
    diagnostics.put(
        "trace",
        new LinkedHashMap<>(Map.of("vector", new ArrayList<>(List.of(e("a", "d", "text"))))));
    return new RetrievalOutcome(
        List.of(e("a", "d", "text")),
        RetrievalOptions.defaults(1),
        diagnostics,
        new LinkedHashMap<>(),
        error,
        20);
  }

  @Test
  void defaultOptionsPreserveLegacyJsonAndExplicitOffCanonicalizes() {
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
    var old = new RetrievalOptions(20, 1d, false, "uuid");
    var explicit =
        new RetrievalOptions(20, 1d, false, "uuid", "always", false, false).normalized(5);
    assertEquals(mapper.valueToTree(old), mapper.valueToTree(explicit));
    assertFalse(mapper.valueToTree(old).has("cache"));
    assertFalse(mapper.valueToTree(old).has("rerankPolicy"));
    assertThrows(
        IllegalArgumentException.class,
        () -> new RetrievalOptions(20, 1d, true, "uuid", "guess", false, false).normalized(5));
  }

  @Test
  void exactGroupingRetainsDifferentDocumentsAndLocations() {
    Evidence first = e("a", "d1", "same"),
        second = e("b", "d2", "same"),
        third = e("c", "d3", "Same");
    var grouped = RetrievalCandidates.group(List.of(first, second, third), true);
    assertEquals(2, grouped.representatives().size());
    assertEquals(
        List.of("a", "b"), grouped.groups().getFirst().stream().map(Evidence::id).toList());
    var expanded =
        grouped.expand(
            new RerankGateway.Result(
                List.of(new RerankGateway.Ranked(0, .9), new RerankGateway.Ranked(1, .5)), null),
            3);
    assertEquals(List.of("a", "b", "c"), expanded.stream().map(Evidence::id).toList());
    assertEquals(
        3,
        RetrievalCandidates.group(List.of(first, second, third), false).representatives().size());
  }

  @Test
  void malformedRerankMappingCannotReachEvidence() {
    var group = RetrievalCandidates.group(List.of(e("a", "d", "a"), e("b", "d", "b")), true);
    for (var result :
        List.of(
            List.of(new RerankGateway.Ranked(9, 1d)),
            List.of(new RerankGateway.Ranked(0, Double.NaN)),
            List.of(new RerankGateway.Ranked(0, 1d), new RerankGateway.Ranked(0, .5))))
      assertThrows(
          SpringAiGateway.ModelFailure.class,
          () -> group.expand(new RerankGateway.Result(result, null), result.size()));
    assertThrows(
        SpringAiGateway.ModelFailure.class,
        () -> group.expand(new RerankGateway.Result(List.of(), null), 1));
  }

  @Test
  void ttlCapacityFailureExclusionAndDeepCopyAreReal() {
    var clock = new AtomicLong();
    var cache = new RetrievalCache(1, 1, 100000, clock::get);
    cache.put("a", outcome(null));
    var first = cache.get("a");
    first.diagnostics().put("rawAnswer", "must not leak");
    assertFalse(cache.get("a").diagnostics().containsKey("rawAnswer"));
    cache.put("failure", outcome("PROVIDER_TIMEOUT"));
    assertNull(cache.get("failure"));
    assertNotNull(cache.get("a"));
    cache.put("b", outcome(null));
    assertNull(cache.get("a"));
    assertEquals(1, cache.size());
    clock.set(1000000000L);
    assertNull(cache.get("b"));
    assertEquals(0, cache.size());
  }

  @Test
  void cacheKeyCanonicalAndByteBounded() {
    var cache = new RetrievalCache(2, 1, 1024, System::nanoTime);
    assertEquals(cache.key(Map.of("a", 1, "b", 2)), cache.key(Map.of("b", 2, "a", 1)));
    var huge =
        new RetrievalOutcome(
            List.of(e("a", "d", "x".repeat(2000))),
            RetrievalOptions.defaults(1),
            Map.of(),
            Map.of(),
            null,
            1);
    cache.put("large", huge);
    assertNull(cache.get("large"));
    assertNotEquals(cache.key(Map.of("user", "alice")), cache.key(Map.of("user", "bob")));
  }
}
