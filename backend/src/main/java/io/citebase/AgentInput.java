package io.citebase;

import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class AgentInput {
  public record Request(
      String kbId,
      String question,
      String mode,
      int topK,
      RetrievalOptions retrievalOptions,
      AgentPolicy budget,
      String idempotencyKey) {}

  private final ObjectMapper json =
      new ObjectMapper()
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

  public Request parse(String source) {
    try {
      if (source.length() > 30000) throw new IllegalArgumentException("Agent请求过长");
      JsonNode n = json.readTree(source);
      fields(
          n,
          Set.of(
              "kbId", "question", "mode", "topK", "retrievalOptions", "budget", "idempotencyKey"));
      String kb = text(n, "kbId", 100, true),
          q = text(n, "question", 4000, true),
          key = text(n, "idempotencyKey", 100, true),
          mode = n.has("mode") ? text(n, "mode", 20, true) : "vector";
      if (!Set.of("vector", "hybrid").contains(mode)) throw new IllegalArgumentException("mode无效");
      int k = integer(n, "topK", 5, 20);
      RetrievalOptions options = null;
      if (n.has("retrievalOptions")) {
        var o = n.get("retrievalOptions");
        fields(o, Set.of("candidateK", "keywordWeight", "rerank", "citationStyle"));
        Integer ck = o.has("candidateK") ? integer(o, "candidateK", 20, 100) : null;
        Double w = null;
        Boolean rerank = null;
        String style = null;
        if (o.has("keywordWeight")) {
          if (!o.get("keywordWeight").isNumber())
            throw new IllegalArgumentException("keywordWeight类型无效");
          w = o.get("keywordWeight").doubleValue();
        }
        if (o.has("rerank")) {
          if (!o.get("rerank").isBoolean()) throw new IllegalArgumentException("rerank类型无效");
          rerank = o.get("rerank").booleanValue();
        }
        if (o.has("citationStyle")) style = text(o, "citationStyle", 20, true);
        options = new RetrievalOptions(ck, w, rerank, style);
      }
      var p = AgentPolicy.DEFAULT;
      if (n.has("budget")) {
        var b = n.get("budget");
        fields(
            b,
            Set.of(
                "maxPlannerSteps",
                "maxTools",
                "maxSearch",
                "maxEvidence",
                "maxEvidenceChars",
                "deadlineSeconds",
                "maxPlannerOutputTokens",
                "maxFinalOutputTokens",
                "maxExternalCalls"));
        p =
            new AgentPolicy(
                integer(b, "maxPlannerSteps", 4, 4),
                integer(b, "maxTools", 4, 4),
                integer(b, "maxSearch", 2, 2),
                integer(b, "maxEvidence", 12, 12),
                integer(b, "maxEvidenceChars", 20000, 20000),
                integer(b, "deadlineSeconds", 120, 120),
                integer(b, "maxPlannerOutputTokens", 256, 256),
                integer(b, "maxFinalOutputTokens", 1024, 1024),
                integer(b, "maxExternalCalls", 10, 10));
      }
      return new Request(kb, q, mode, k, RetrievalOptions.resolve(options, k), p, key);
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalArgumentException("Agent JSON无效");
    }
  }

  static void fields(JsonNode n, Set<String> allowed) {
    if (n == null || !n.isObject()) throw new IllegalArgumentException("必须为JSON对象");
    n.fieldNames()
        .forEachRemaining(
            k -> {
              if (!allowed.contains(k)) throw new IllegalArgumentException("未知字段: " + k);
            });
  }

  static String text(JsonNode n, String key, int max, boolean required) {
    var v = n.get(key);
    if (v == null && !required) return null;
    if (v == null
        || !v.isTextual()
        || v.textValue().isBlank()
        || v.textValue().length() > max
        || v.textValue().indexOf('\0') >= 0) throw new IllegalArgumentException(key + "长度或类型无效");
    return v.textValue();
  }

  static int integer(JsonNode n, String key, int fallback, int max) {
    var v = n.get(key);
    if (v == null) return fallback;
    if (!v.isIntegralNumber() || !v.canConvertToInt() || v.intValue() < 1 || v.intValue() > max)
      throw new IllegalArgumentException(key + "预算范围无效");
    return v.intValue();
  }
}
