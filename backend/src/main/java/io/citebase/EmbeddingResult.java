package io.citebase;

import java.util.Map;

public record EmbeddingResult(float[] vector, Map<String, Object> usage) {}
