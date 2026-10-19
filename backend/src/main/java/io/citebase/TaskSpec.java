package io.citebase;

public record TaskSpec(
    TaskKind kind,
    String userId,
    String kbId,
    String resourceId,
    String idempotencyKey,
    Object payload,
    int maxAttempts) {}
