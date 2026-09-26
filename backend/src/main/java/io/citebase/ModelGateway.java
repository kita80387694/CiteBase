package io.citebase;

import java.util.List;

public interface ModelGateway {
  float[] embed(String text);

  Generation generate(String question, List<Evidence> evidence);

  String mode();

  String chatModel();

  String embeddingModel();

  default java.util.Map<String, Object> configuration() {
    return java.util.Map.of("provider", "mock-local");
  }
}
