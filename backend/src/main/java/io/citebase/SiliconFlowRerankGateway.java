package io.citebase;

import com.fasterxml.jackson.databind.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Dedicated reranking protocol; no chat-based substitute and no silent fallback. */
public class SiliconFlowRerankGateway implements RerankGateway {
  private final String base, key, model;
  private final int timeout;
  private final HttpClient client;
  private final ObjectMapper json = new ObjectMapper();

  public SiliconFlowRerankGateway(String base, String key, String model, int timeout) {
    this.base = base;
    this.key = key;
    this.model = model;
    this.timeout = timeout;
    if (timeout < 1 || timeout > 300)
      throw new IllegalArgumentException("RERANK_TIMEOUT_SECONDS必须1–300");
    client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(timeout)).build();
  }

  public Result rerank(String query, List<Evidence> documents, int topK) {
    if (key == null
        || key.isBlank()
        || base == null
        || base.isBlank()
        || model == null
        || model.isBlank()) throw new SpringAiGateway.ModelFailure("Rerank未配置独立供应商密钥/地址/模型", null);
    if (documents.isEmpty()) return new Result(List.of(), null);
    try {
      int n = Math.min(topK, documents.size());
      var body =
          Map.of(
              "model",
              model,
              "query",
              query,
              "documents",
              documents.stream().map(Evidence::text).toList(),
              "top_n",
              n,
              "return_documents",
              false);
      var request =
          HttpRequest.newBuilder(URI.create(base.replaceAll("/+$", "") + "/v1/rerank"))
              .timeout(Duration.ofSeconds(timeout))
              .header("Authorization", "Bearer " + key)
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
              .build();
      var response = client.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200)
        throw new SpringAiGateway.ModelFailure(
            ProviderFailures.fromStatus(response.statusCode()), null);
      JsonNode root = json.readTree(response.body());
      var nodes = root == null ? null : root.get("results");
      if (nodes == null || !nodes.isArray() || nodes.size() != n)
        throw new IllegalArgumentException("invalid result count");
      var seen = new HashSet<Integer>();
      var results = new ArrayList<Ranked>();
      for (var node : nodes) {
        var index = node.get("index");
        var score = node.get("relevance_score");
        if (index == null
            || !index.isIntegralNumber()
            || !index.canConvertToInt()
            || index.intValue() < 0
            || index.intValue() >= documents.size()
            || !seen.add(index.intValue())
            || score == null
            || !score.isNumber()
            || !Double.isFinite(score.doubleValue()))
          throw new IllegalArgumentException("invalid rerank index/score");
        results.add(new Ranked(index.intValue(), score.doubleValue()));
      }
      results.sort(
          Comparator.comparingDouble(Ranked::score).reversed().thenComparingInt(Ranked::index));
      return new Result(results, usage(root));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new SpringAiGateway.ModelFailure("PROVIDER_ERROR", e);
    } catch (Exception e) {
      throw new SpringAiGateway.ModelFailure(ProviderFailures.code(e), e);
    }
  }

  private Map<String, Object> usage(JsonNode root) {
    JsonNode usage = root.get("usage"), tokens = root.path("meta").get("tokens");
    if ((usage == null || !usage.isObject()) && (tokens == null || !tokens.isObject())) return null;
    var result = new LinkedHashMap<String, Object>();
    result.put("promptTokens", count(usage, "prompt_tokens", tokens, "input_tokens"));
    result.put("completionTokens", count(usage, "completion_tokens", tokens, "output_tokens"));
    result.put("totalTokens", count(usage, "total_tokens", tokens, "total_tokens"));
    if (usage != null && usage.isObject())
      result.put("providerUsage", json.convertValue(usage, Map.class));
    if (tokens != null && tokens.isObject())
      result.put("providerTokens", json.convertValue(tokens, Map.class));
    var billed = root.path("meta").get("billed_units");
    if (billed != null && billed.isObject())
      result.put("billedUnits", json.convertValue(billed, Map.class));
    return result;
  }

  private Long count(JsonNode first, String a, JsonNode second, String b) {
    JsonNode value = first == null ? null : first.get(a);
    if (value == null || value.isNull()) value = second == null ? null : second.get(b);
    if (value == null || value.isNull()) return null;
    if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0)
      throw new IllegalArgumentException("invalid provider usage");
    return value.longValue();
  }

  public Map<String, Object> configuration() {
    var result = new LinkedHashMap<String, Object>();
    result.put("provider", "SiliconFlow-compatible /v1/rerank");
    result.put("model", model);
    result.put("timeoutSeconds", timeout);
    if (base != null && !base.isBlank()) {
      var uri = URI.create(base);
      result.put(
          "endpoint",
          uri.getScheme()
              + "://"
              + uri.getHost()
              + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
              + Objects.toString(uri.getPath(), ""));
    }
    result.put("configured", key != null && !key.isBlank());
    return result;
  }
}
