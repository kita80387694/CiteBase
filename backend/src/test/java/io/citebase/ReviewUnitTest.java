package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class ReviewUnitTest {
  static Map<String, Object> valid() {
    return new LinkedHashMap<>(
        Map.of(
            "correctness",
            "CORRECT",
            "completeness",
            "PARTIAL",
            "citationSupport",
            "NA",
            "unsupportedContent",
            "NONE",
            "refusal",
            "NOT_REFUSED",
            "rationale",
            "人工依据：证据支持主要结论"));
  }

  @Test
  void canonicalizesNestedJsonOrder() {
    var a = new LinkedHashMap<String, Object>();
    a.put("z", List.of(Map.of("b", 2, "a", 1)));
    a.put("a", null);
    var b = new LinkedHashMap<String, Object>();
    b.put("a", null);
    b.put("z", List.of(Map.of("a", 1, "b", 2)));
    assertEquals(ReviewService.canonical(a).toString(), ReviewService.canonical(b).toString());
  }

  @Test
  void separatesMissingAndNa() {
    assertEquals("NA", ReviewService.validateScore(valid()).get("citationSupport"));
    var b = valid();
    b.remove("correctness");
    assertThrows(RuntimeException.class, () -> ReviewService.validateScore(b));
    b.put("correctness", null);
    assertThrows(RuntimeException.class, () -> ReviewService.validateScore(b));
  }

  @Test
  void rejectsImpersonationAndAutomaticScoring() {
    for (String key : List.of("scoredBy", "source", "model", "ruleVersion", "answer")) {
      var b = valid();
      b.put(key, "forged");
      assertThrows(RuntimeException.class, () -> ReviewService.validateScore(b));
    }
  }

  @Test
  void requiresEvidenceRationale() {
    var b = valid();
    b.put("rationale", " ");
    assertThrows(RuntimeException.class, () -> ReviewService.validateScore(b));
    b.put("rationale", "x".repeat(4001));
    assertThrows(RuntimeException.class, () -> ReviewService.validateScore(b));
  }
}
