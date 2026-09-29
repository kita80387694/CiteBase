package io.citebase;

/** Internal attempt identity; never populated from an HTTP request. */
final class EvaluationCallScope {
  private static final ThreadLocal<String> ATTEMPT = new ThreadLocal<>();

  static void bind(String attempt) {
    ATTEMPT.set(attempt);
  }

  static void clear() {
    ATTEMPT.remove();
  }

  static String operation(String kind) {
    return (ATTEMPT.get() == null ? "" : ATTEMPT.get() + ":")
        + kind
        + ":"
        + java.util.UUID.randomUUID();
  }
}
