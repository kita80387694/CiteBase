package io.citebase;

import java.util.*;

public final class EvaluationMetrics {
  public record Label(
      String documentName,
      Integer page,
      Integer paragraph,
      String quote,
      String sourceHash,
      Integer startOffset,
      Integer endOffset,
      String groupId) {
    public Label(String documentName, Integer page, Integer paragraph, String quote) {
      this(documentName, page, paragraph, quote, null, null, null, null);
    }
  }

  public record Score(Double recallAtK, Double mrr, boolean evidenceHit) {}

  public static boolean matches(Label label, Evidence e) {
    return matches(label, e, Map.of());
  }

  public static boolean matches(Label label, Evidence e, Map<String, String> versionHashes) {
    return Objects.equals(label.documentName(), e.documentName())
        && (label.sourceHash() == null
            || Objects.equals(label.sourceHash(), versionHashes.get(e.versionId())))
        && (label.page() == null || label.page() == e.page())
        && (label.startOffset() != null
            || label.paragraph() == null
            || label.paragraph() == e.paragraph())
        && label.quote() != null
        && !label.quote().isBlank()
        && (label.startOffset() == null
            ? e.text().contains(label.quote())
            : label.endOffset() != null
                && label.startOffset() >= e.startOffset()
                && label.endOffset() <= e.endOffset()
                && label.endOffset() > label.startOffset()
                && label.endOffset() - e.startOffset() <= e.text().length()
                && e.text()
                    .substring(
                        label.startOffset() - e.startOffset(), label.endOffset() - e.startOffset())
                    .equals(label.quote()));
  }

  public static Score compute(List<Label> expected, List<Evidence> found) {
    return compute(expected, found, Map.of());
  }

  public static Map<String, List<Label>> groups(List<Label> expected) {
    var groups = new LinkedHashMap<String, List<Label>>();
    for (int i = 0; i < expected.size(); i++) {
      var label = expected.get(i);
      String key = label.groupId() == null ? "item:" + i : "group:" + label.groupId();
      groups.computeIfAbsent(key, k -> new ArrayList<>()).add(label);
    }
    return groups;
  }

  public static long hitGroups(
      List<Label> expected, List<Evidence> found, Map<String, String> hashes) {
    return groups(expected).values().stream()
        .filter(
            labels ->
                labels.stream().anyMatch(l -> found.stream().anyMatch(e -> matches(l, e, hashes))))
        .count();
  }

  public static Score compute(
      List<Label> expected, List<Evidence> found, Map<String, String> hashes) {
    if (expected.isEmpty()) return new Score(null, null, false);
    long hits = hitGroups(expected, found, hashes);
    double reciprocal = 0;
    for (int i = 0; i < found.size(); i++) {
      var e = found.get(i);
      if (expected.stream().anyMatch(l -> matches(l, e, hashes))) {
        reciprocal = 1.0 / (i + 1);
        break;
      }
    }
    return new Score((double) hits / groups(expected).size(), reciprocal, hits > 0);
  }

  private EvaluationMetrics() {}
}
