package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class ProviderFailuresTest {
  @ParameterizedTest
  @CsvSource({
    "401,PROVIDER_AUTH_ERROR,false",
    "402,PROVIDER_PAYMENT_REQUIRED,false",
    "429,PROVIDER_RATE_LIMIT,true",
    "503,PROVIDER_UNAVAILABLE,true"
  })
  void actualHttpStatusSurvivesAllFourAdaptersWithoutResponseBody(
      int status, String code, boolean retryable) throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          byte[] body =
              "{\"error\":{\"message\":\"SECRET_RESPONSE_FIXTURE\"}}"
                  .getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.sendResponseHeaders(status, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      String base = "http://127.0.0.1:" + server.getAddress().getPort();
      var gateway = new SpringAiGateway(base, "fixture", "chat", base, "fixture", "embed", 1);
      var evidence = List.of(new Evidence("e1", "d", "guide.md", "v", 1, 1, 0, 4, "data", 1));
      var generated = gateway.generate("q", evidence);
      assertEquals(code, generated.error());
      assertNull(generated.promptTokens());
      var embedded = assertThrows(SpringAiGateway.ModelFailure.class, () -> gateway.embed("q"));
      assertEquals(code, embedded.getMessage());
      var planned =
          new SpringAiAgentPlannerGateway(base, "fixture", "chat")
              .plan("q", evidence, List.of(), 32, 1);
      assertEquals(code, planned.error());
      assertNull(planned.promptTokens());
      var reranked =
          assertThrows(
              SpringAiGateway.ModelFailure.class,
              () ->
                  new SiliconFlowRerankGateway(base, "fixture", "reranker", 1)
                      .rerank("q", evidence, 1));
      assertEquals(code, reranked.getMessage());
      assertEquals(retryable, ProviderFailures.retryable(code));
    } finally {
      server.stop(0);
    }
  }
}
