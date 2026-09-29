package io.citebase;

public record TaskFailure(
    String code, String safeMessage, boolean retryable, boolean externalOutcomeUnknown) {}
