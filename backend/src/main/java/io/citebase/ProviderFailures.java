package io.citebase;

import java.util.*;
import java.util.regex.Pattern;
import org.springframework.web.client.RestClientResponseException;

/** Only fixed codes leave the provider boundary; response bodies never become task errors. */
public final class ProviderFailures {
  private ProviderFailures() {}

  private static final Pattern HTTP_PREFIX = Pattern.compile("^(\\d{3})(?:\\s|:|$)");
  private static final Set<String> CODES =
      Set.of(
          "PROVIDER_PAYMENT_REQUIRED",
          "PROVIDER_AUTH_ERROR",
          "PROVIDER_RATE_LIMIT",
          "PROVIDER_TIMEOUT",
          "PROVIDER_UNAVAILABLE",
          "PROVIDER_INVALID_RESPONSE",
          "PROVIDER_ERROR");

  public static String fromStatus(int status) {
    if (status == 402) return "PROVIDER_PAYMENT_REQUIRED";
    if (status == 401 || status == 403) return "PROVIDER_AUTH_ERROR";
    if (status == 429) return "PROVIDER_RATE_LIMIT";
    if (status == 408 || status == 504) return "PROVIDER_TIMEOUT";
    if (status >= 500 && status <= 599) return "PROVIDER_UNAVAILABLE";
    return "PROVIDER_ERROR";
  }

  public static String safeCode(String code) {
    return CODES.contains(Objects.toString(code, "")) ? code : "PROVIDER_ERROR";
  }

  public static boolean retryable(String code) {
    return Set.of("PROVIDER_RATE_LIMIT", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE")
        .contains(Objects.toString(code, ""));
  }

  public static String code(Throwable error) {
    var seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
    String fallback = "PROVIDER_ERROR";
    for (Throwable current = error;
        current != null && seen.add(current);
        current = current.getCause()) {
      if (current instanceof RestClientResponseException response)
        return fromStatus(response.getStatusCode().value());
      if (current instanceof SpringAiGateway.ModelFailure
          && CODES.contains(Objects.toString(current.getMessage(), "")))
        return current.getMessage();
      // Spring AI wraps status in an AI exception and may omit the HTTP exception cause.
      if (current.getClass().getName().startsWith("org.springframework.ai.retry.")) {
        var match = HTTP_PREFIX.matcher(Objects.toString(current.getMessage(), ""));
        if (match.find()) return fromStatus(Integer.parseInt(match.group(1)));
      }
      if (current instanceof java.net.SocketTimeoutException
          || current instanceof java.net.http.HttpTimeoutException
          || current instanceof java.util.concurrent.TimeoutException) return "PROVIDER_TIMEOUT";
      if (current instanceof com.fasterxml.jackson.core.JsonProcessingException)
        return "PROVIDER_INVALID_RESPONSE";
      if (current instanceof java.io.IOException) fallback = "PROVIDER_UNAVAILABLE";
      else if (current instanceof IllegalArgumentException
          || current instanceof IllegalStateException) fallback = "PROVIDER_INVALID_RESPONSE";
    }
    return fallback;
  }
}
