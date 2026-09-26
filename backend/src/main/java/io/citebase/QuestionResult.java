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
    String error) {}
