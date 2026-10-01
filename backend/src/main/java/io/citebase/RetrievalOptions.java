package io.citebase;

public record RetrievalOptions(
    Integer candidateK,
    Double keywordWeight,
    Boolean rerank,
    String citationStyle,
    @com.fasterxml.jackson.annotation.JsonInclude(
            com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        String rerankPolicy,
    @com.fasterxml.jackson.annotation.JsonInclude(
            com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        Boolean deduplicate,
    @com.fasterxml.jackson.annotation.JsonInclude(
            com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
        Boolean cache) {
  public RetrievalOptions(
      Integer candidateK, Double keywordWeight, Boolean rerank, String citationStyle) {
    this(candidateK, keywordWeight, rerank, citationStyle, null, null, null);
  }

  public boolean conditionalRerank() {
    return "candidate-pressure-v1".equals(rerankPolicy);
  }

  public boolean deduplicateEnabled() {
    return Boolean.TRUE.equals(deduplicate);
  }

  public boolean cacheEnabled() {
    return Boolean.TRUE.equals(cache);
  }

  public static RetrievalOptions defaults(int topK) {
    return new RetrievalOptions(Math.max(20, topK * 4), 1.0, false, "uuid");
  }

  public RetrievalOptions normalized(int topK) {
    if (topK < 1 || topK > 20) throw new IllegalArgumentException("topK必须为1–20");
    var defaults = defaults(topK);
    int candidates = candidateK == null ? defaults.candidateK() : candidateK;
    double weight = keywordWeight == null ? 1 : keywordWeight;
    String style = citationStyle == null ? "uuid" : citationStyle;
    if (candidates < topK
        || candidates > 100
        || !Double.isFinite(weight)
        || weight < 0
        || weight > 4
        || !java.util.Set.of("uuid", "compact").contains(style))
      throw new IllegalArgumentException("retrievalOptions参数越界");
    if (rerankPolicy != null
        && !java.util.Set.of("always", "candidate-pressure-v1").contains(rerankPolicy))
      throw new IllegalArgumentException("rerankPolicy无效");
    return new RetrievalOptions(
        candidates,
        weight,
        Boolean.TRUE.equals(rerank),
        style,
        conditionalRerank() ? rerankPolicy : null,
        deduplicateEnabled() ? true : null,
        cacheEnabled() ? true : null);
  }

  public static RetrievalOptions resolve(RetrievalOptions options, int topK) {
    return (options == null ? defaults(topK) : options).normalized(topK);
  }
}
