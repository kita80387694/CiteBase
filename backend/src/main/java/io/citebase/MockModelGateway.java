package io.citebase;

import java.util.*;

/** Deterministic business-flow fixture, NOT a semantic embedding or language model. */
public class MockModelGateway implements ModelGateway {
  public float[] embed(String text) {
    float[] vector = new float[256];
    for (String token : Lexical.tokens(text).split(" "))
      if (!token.isBlank()) vector[Math.floorMod(token.hashCode(), vector.length)]++;
    double length = 0;
    for (float x : vector) length += x * x;
    if (length == 0) vector[0] = 1;
    else for (int i = 0; i < vector.length; i++) vector[i] /= (float) Math.sqrt(length);
    return vector;
  }

  public Generation generate(String question, List<Evidence> evidence) {
    if (evidence.isEmpty()) return new Generation(Citations.ABSTENTION, null, null, null);
    var q =
        new HashSet<>(Arrays.asList(Lexical.tokens(question).split(" ")))
            .stream().filter(t -> t.length() > 1).toList();
    var best =
        evidence.stream()
            .filter(e -> q.stream().anyMatch(t -> Lexical.tokens(e.text()).contains(t)))
            .findFirst();
    if (best.isEmpty()) return new Generation(Citations.ABSTENTION, null, null, null);
    return new Generation(
        "【MOCK 流程演示，非模型回答】证据摘录：" + best.get().text() + " [" + best.get().id() + "]",
        null,
        null,
        null);
  }

  public String mode() {
    return "mock";
  }

  public String chatModel() {
    return "mock-extract-v1";
  }

  public String embeddingModel() {
    return "mock-hash-256-v1";
  }
}
