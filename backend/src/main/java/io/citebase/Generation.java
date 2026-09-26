package io.citebase;

public record Generation(String answer, Long promptTokens, Long completionTokens, String error) {}
