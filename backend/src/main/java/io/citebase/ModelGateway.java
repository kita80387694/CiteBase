package io.citebase;

import java.util.List;

public interface ModelGateway {
  float[] embed(String text);

  default EmbeddingResult embedWithUsage(String text) {
    return new EmbeddingResult(embed(text), null);
  }

  Generation generate(String question, List<Evidence> evidence);

  default Generation generateBounded(
      String question, List<Evidence> evidence, int maxOutputTokens, int timeoutSeconds) {
    return generate(question, evidence);
  }

  default Generation generateBounded(
      String question,
      List<Evidence> evidence,
      int maxOutputTokens,
      int timeoutSeconds,
      String policy) {
    GenerationPolicy.validate(policy);
    return generateBounded(question, evidence, maxOutputTokens, timeoutSeconds);
  }

  String mode();

  String chatModel();

  String embeddingModel();

  default java.util.Map<String, Object> configuration() {
    return java.util.Map.of("provider", "mock-local");
  }
}
