package io.citebase;

public record TaskCall(String callId, String operationKey, long fencingToken) {}
