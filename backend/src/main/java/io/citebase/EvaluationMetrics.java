package io.citebase;

import java.util.*;

public final class EvaluationMetrics {
  public record Label(String documentName, Integer page, Integer paragraph, String quote) {}

  public record Score(Double recallAtK, Double mrr, boolean evidenceHit) {}

  public static boolean matches(Label label, Evidence e) {
    return Objects.equals(label.documentName(), e.documentName())
        && (label.page() == null || label.page() == e.page())
        && (label.paragraph() == null || label.paragraph() == e.paragraph())
        && label.quote() != null
        && !label.quote().isBlank()
        && e.text().contains(label.quote());
  }

  public static Score compute(List<Label> expected, List<Evidence> found) {
    if (expected.isEmpty()) return new Score(null, null, false);
    long hits = expected.stream().filter(l -> found.stream().anyMatch(e -> matches(l, e))).count();
    double reciprocal = 0;
    for (int i = 0; i < found.size(); i++) {
      var e = found.get(i);
      if (expected.stream().anyMatch(l -> matches(l, e))) {
        reciprocal = 1.0 / (i + 1);
        break;
      }
    }
    return new Score((double) hits / expected.size(), reciprocal, hits > 0);
  }

  private EvaluationMetrics() {}
}
