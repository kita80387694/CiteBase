package io.citebase;

import java.util.*;

public record RetrievalOutcome(
    List<Evidence> evidence,
    RetrievalOptions options,
    Map<String, Object> diagnostics,
    Map<String, Object> usage,
    String error,
    long retrievalMs) {}
