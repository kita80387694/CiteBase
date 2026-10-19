package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;

class RetrievalProtocolTest {
  HttpServer server;
  String base;

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    base = "http://127.0.0.1:" + server.getAddress().getPort();
    server.start();
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  List<Evidence> evidence() {
    return List.of(
        new Evidence("uuid-a", "d", "a.md", "v", 1, 1, 0, 5, "alpha", 1),
        new Evidence("uuid-b", "d", "a.md", "v", 1, 2, 6, 10, "beta", .5));
  }

  void respond(String path, int status, String body) {
    server.createContext(
        path,
        x -> {
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          x.getResponseHeaders().add("Content-Type", "application/json");
          x.sendResponseHeaders(status, bytes.length);
          x.getResponseBody().write(bytes);
          x.close();
        });
  }

  SiliconFlowRerankGateway reranker() {
    return new SiliconFlowRerankGateway(base, "fixture-only", "rerank-fixture", 1);
  }

  @Test
  void dedicatedProtocolPreservesActualUsageAndScores() throws Exception {
    var request = new java.util.concurrent.atomic.AtomicReference<String>();
    server.createContext(
        "/v1/rerank",
        x -> {
          request.set(new String(x.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          String body =
              "{\"results\":[{\"index\":0,\"relevance_score\":0.1},{\"index\":1,\"relevance_score\":0.9}],\"meta\":{\"tokens\":{\"input_tokens\":122,\"output_tokens\":0},\"billed_units\":{\"input_tokens\":122,\"output_tokens\":0}}}";
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          x.sendResponseHeaders(200, bytes.length);
          x.getResponseBody().write(bytes);
          x.close();
        });
    var result = reranker().rerank("q", evidence(), 2);
    assertEquals(1, result.results().getFirst().index());
    assertEquals(122L, result.usage().get("promptTokens"));
    assertEquals(0L, result.usage().get("completionTokens"));
    assertNull(result.usage().get("totalTokens"));
    assertNotNull(result.usage().get("billedUnits"));
    var sent = new com.fasterxml.jackson.databind.ObjectMapper().readTree(request.get());
    assertEquals("rerank-fixture", sent.path("model").asText());
    assertEquals("alpha", sent.path("documents").get(0).asText());
    assertFalse(sent.has("messages"));
    assertEquals(2, sent.path("top_n").intValue());
  }

  @Test
  void malformedRerankNeverSilentlyFallsBack() {
    var payloads =
        List.of(
            "{}",
            "null",
            "{\"results\":[]}",
            "{\"results\":[{\"index\":0,\"relevance_score\":0.5},{\"index\":0,\"relevance_score\":0.6}]}",
            "{\"results\":[{\"index\":0,\"relevance_score\":0.5},{\"index\":2,\"relevance_score\":0.6}]}",
            "{\"results\":[{\"index\":-1,\"relevance_score\":0.5},{\"index\":1,\"relevance_score\":0.6}]}",
            "{\"results\":[{\"index\":0.0,\"relevance_score\":0.5},{\"index\":1,\"relevance_score\":0.6}]}",
            "{\"results\":[{\"index\":0,\"relevance_score\":1e309},{\"index\":1,\"relevance_score\":0.6}]}",
            "{\"results\":[{\"index\":0,\"relevance_score\":\"0.5\"},{\"index\":1,\"relevance_score\":0.6}]}");
    for (String body : payloads) {
      respond("/v1/rerank", 200, body);
      assertThrows(SpringAiGateway.ModelFailure.class, () -> reranker().rerank("q", evidence(), 2));
      server.removeContext("/v1/rerank");
    }
  }

  @Test
  void rateLimitTimeoutAndMissingConfigurationAreFailures() {
    respond("/v1/rerank", 429, "{}");
    assertThrows(SpringAiGateway.ModelFailure.class, () -> reranker().rerank("q", evidence(), 1));
    server.removeContext("/v1/rerank");
    server.createContext(
        "/v1/rerank",
        x -> {
          try {
            Thread.sleep(1400);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          x.close();
        });
    assertThrows(SpringAiGateway.ModelFailure.class, () -> reranker().rerank("q", evidence(), 1));
    assertThrows(
        SpringAiGateway.ModelFailure.class,
        () -> new SiliconFlowRerankGateway(base, null, "model", 1).rerank("q", evidence(), 1));
  }

  @Test
  void missingUsageIsNullNotInvented() {
    respond("/v1/rerank", 200, "{\"results\":[{\"index\":1,\"relevance_score\":0.9}]}");
    assertNull(reranker().rerank("q", evidence(), 1).usage());
  }

  @Test
  void springAiEmbeddingCallExposesActualUsage() {
    respond(
        "/v1/embeddings",
        200,
        "{\"object\":\"list\",\"data\":[{\"object\":\"embedding\",\"index\":0,\"embedding\":[0.2,0.4]}],\"model\":\"fixture\",\"usage\":{\"prompt_tokens\":7,\"total_tokens\":7}}");
    var gateway = new SpringAiGateway(base, "key", "chat", base, "key", "embedding", 1);
    var result = gateway.embedWithUsage("q");
    assertEquals(2, result.vector().length);
    assertEquals(7, ((Number) result.usage().get("promptTokens")).intValue());
    assertEquals(7, ((Number) result.usage().get("totalTokens")).intValue());
  }

  @Test
  void springAiDefaultsNeverInventMissingEmbeddingTokenFields() {
    respond(
        "/v1/embeddings",
        200,
        "{\"data\":[{\"index\":0,\"embedding\":[0.2,0.4]}],\"usage\":{\"prompt_tokens\":7}}");
    var result =
        new SpringAiGateway(base, "key", "chat", base, "key", "embedding", 1).embedWithUsage("q");
    assertEquals(7L, result.usage().get("promptTokens"));
    assertNull(result.usage().get("totalTokens"));
    server.removeContext("/v1/embeddings");
    respond("/v1/embeddings", 200, "{\"data\":[{\"index\":0,\"embedding\":[0.2,0.4]}]}");
    assertNull(
        new SpringAiGateway(base, "key", "chat", base, "key", "embedding", 1)
            .embedWithUsage("q")
            .usage());
  }

  @Test
  void compactMappingValidatesEverySourceAndKeepsUuidDefault() {
    var ctx = CitationAliases.prepare(evidence(), "compact");
    assertEquals("E1", ctx.promptEvidence().getFirst().id());
    String restored = CitationAliases.restore("answer [E2] [E1]", ctx.aliases());
    assertEquals("answer [uuid-b] [uuid-a]", restored);
    assertTrue(Citations.validate(restored, evidence()).valid());
    for (String invalid : List.of("[E0]", "[E3]", "[uuid-a]", "[999]"))
      assertThrows(
          IllegalArgumentException.class, () -> CitationAliases.restore(invalid, ctx.aliases()));
    assertFalse(
        Citations.validate(CitationAliases.restore("broken [E1", ctx.aliases()), evidence())
            .valid());
    assertEquals(evidence(), CitationAliases.prepare(evidence(), "uuid").promptEvidence());
  }

  @Test
  void optionsRejectTypesUnknownsAndRanges() {
    var input = new EvaluationInput(new com.fasterxml.jackson.databind.ObjectMapper());
    String prefix = "{\"kbId\":\"k\",\"question\":\"q\",\"topK\":5,\"retrievalOptions\":";
    for (String options :
        List.of(
            "{\"candidateK\":4}",
            "{\"candidateK\":101}",
            "{\"candidateK\":\"20\"}",
            "{\"keywordWeight\":-1}",
            "{\"keywordWeight\":4.1}",
            "{\"keywordWeight\":1e309}",
            "{\"rerank\":\"true\"}",
            "{\"citationStyle\":\"anything\"}",
            "{\"unknown\":true}"))
      assertThrows(IllegalArgumentException.class, () -> input.ask(prefix + options + "}"));
    var options =
        input
            .ask(prefix + "{\"keywordWeight\":0,\"rerank\":false,\"citationStyle\":\"compact\"}}")
            .retrievalOptions()
            .normalized(5);
    assertEquals(20, options.candidateK());
    assertEquals(0, options.keywordWeight());
    assertFalse(options.rerank());
  }
}
