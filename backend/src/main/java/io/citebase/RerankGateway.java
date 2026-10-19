package io.citebase;

import java.util.*;

public interface RerankGateway {
  record Ranked(int index, double score) {}

  record Result(List<Ranked> results, Map<String, Object> usage) {}

  Result rerank(String query, List<Evidence> documents, int topK);

  Map<String, Object> configuration();
}
