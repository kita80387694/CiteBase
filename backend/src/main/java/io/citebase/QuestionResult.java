package io.citebase;

import java.util.List;

public record QuestionResult(
    String id,
    String question,
    String answer,
    String mode,
    String modelMode,
    List<Evidence> evidence,
    List<Evidence> citations,
    boolean citationValid,
    boolean abstained,
    long retrievalMs,
    long totalMs,
    Long promptTokens,
    Long completionTokens,
    String error,
    RetrievalOptions retrievalOptions,
    java.util.Map<String, Object> diagnostics,
    java.util.Map<String, Object> usage) {
  public QuestionResult(
      String id,
      String question,
      String answer,
      String mode,
      String modelMode,
      List<Evidence> evidence,
      List<Evidence> citations,
      boolean citationValid,
      boolean abstained,
      long retrievalMs,
      long totalMs,
      Long promptTokens,
      Long completionTokens,
      String error) {
    this(
        id,
        question,
        answer,
        mode,
        modelMode,
        evidence,
        citations,
        citationValid,
        abstained,
        retrievalMs,
        totalMs,
        promptTokens,
        completionTokens,
        error,
        null,
        null,
        null);
  }
}
