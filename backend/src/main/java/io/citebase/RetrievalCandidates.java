package io.citebase;

import java.util.*;

/** Provider-input-only exact grouping: all authorized source identities remain represented. */
final class RetrievalCandidates {
  record Batch(List<Evidence> representatives, List<List<Evidence>> groups) {
    List<Evidence> expand(RerankGateway.Result result, int topK) {
      if (result == null
          || result.results() == null
          || result.results().size() != Math.min(topK, representatives.size())) throw invalid();
      var seen = new HashSet<Integer>();
      var expanded = new ArrayList<Evidence>();
      for (var row : result.results()) {
        if (row == null
            || row.index() < 0
            || row.index() >= groups.size()
            || !seen.add(row.index())
            || !Double.isFinite(row.score())) throw invalid();
        for (var e : groups.get(row.index()))
          expanded.add(
              new Evidence(
                  e.id(),
                  e.documentId(),
                  e.documentName(),
                  e.versionId(),
                  e.page(),
                  e.paragraph(),
                  e.startOffset(),
                  e.endOffset(),
                  e.text(),
                  row.score()));
      }
      return expanded.stream().limit(topK).toList();
    }

    List<Map<String, Object>> mapping() {
      var rows = new ArrayList<Map<String, Object>>();
      for (int i = 0; i < groups.size(); i++)
        rows.add(Map.of("index", i, "chunkIds", groups.get(i).stream().map(Evidence::id).toList()));
      return rows;
    }
  }

  static Batch group(List<Evidence> original, boolean enabled) {
    var groups = new LinkedHashMap<String, List<Evidence>>();
    int i = 0;
    for (var e : original)
      groups.computeIfAbsent(enabled ? e.text() : "index:" + (i++), k -> new ArrayList<>()).add(e);
    var members = groups.values().stream().map(List::copyOf).toList();
    return new Batch(members.stream().map(List::getFirst).toList(), members);
  }

  private static SpringAiGateway.ModelFailure invalid() {
    return new SpringAiGateway.ModelFailure("PROVIDER_INVALID_RESPONSE", null);
  }
}
