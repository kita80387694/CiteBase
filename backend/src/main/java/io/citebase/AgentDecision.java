package io.citebase;

import java.util.Map;

public record AgentDecision(
    String toolName,
    Map<String, Object> arguments,
    String callId,
    Long promptTokens,
    Long completionTokens,
    String error) {}
