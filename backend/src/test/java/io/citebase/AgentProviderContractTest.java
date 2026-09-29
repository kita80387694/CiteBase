package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;

class AgentProviderContractTest {
  HttpServer server;
  String base;
  final ObjectMapper json = new ObjectMapper();

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

  SpringAiAgentPlannerGateway gateway() {
    return new SpringAiAgentPlannerGateway(base, "fixture", "planner-fixture");
  }

  AgentDecision plan() {
    return gateway().plan("question", List.of(), List.of(), 123, 1);
  }

  String call(String name, String args) throws Exception {
    return json.writeValueAsString(
        Map.of(
            "id",
            "call1",
            "type",
            "function",
            "function",
            Map.of("name", name, "arguments", args)));
  }

  void response(int status, String body, AtomicReference<String> request) {
    server.createContext(
        "/v1/chat/completions",
        x -> {
          request.set(new String(x.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          var data = body.getBytes(StandardCharsets.UTF_8);
          x.getResponseHeaders().set("Content-Type", "application/json");
          x.sendResponseHeaders(status, data.length);
          x.getResponseBody().write(data);
          x.close();
        });
  }

  void tools(String calls, String usage, AtomicReference<String> request) {
    response(
        200,
        "{\"id\":\"r\",\"choices\":[{\"index\":0,\"finish_reason\":\"tool_calls\",\"message\":{\"role\":\"assistant\",\"content\":\"private"
            + " explanation discarded\",\"tool_calls\":["
            + calls
            + "]}}]"
            + usage
            + "}",
        request);
  }

  @Test
  void realSpringAiToolsAreReturnedWithoutExecutionAndBounded() throws Exception {
    var request = new AtomicReference<String>();
    tools(
        call("search", "{\"query\":\"same topic\"}"),
        ",\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":0,\"total_tokens\":7}",
        request);
    var result = plan();
    assertNull(result.error());
    assertEquals("search", result.toolName());
    assertEquals(7L, result.promptTokens());
    assertEquals(0L, result.completionTokens());
    var sent = json.readTree(request.get());
    assertEquals(123, sent.get("max_tokens").asInt());
    assertFalse(sent.get("parallel_tool_calls").asBoolean());
    assertEquals("required", sent.get("tool_choice").asText());
    assertEquals(4, sent.get("tools").size());
    assertTrue(sent.get("tools").get(0).get("function").get("strict").asBoolean());
    assertFalse(json.writeValueAsString(result).contains("private explanation"));
  }

  @Test
  void missingUsageStaysNull() throws Exception {
    tools(call("finish", "{}"), "", new AtomicReference<>());
    var result = plan();
    assertNull(result.error());
    assertNull(result.promptTokens());
    assertNull(result.completionTokens());
  }

  @Test
  void parallelCallsRejected() throws Exception {
    tools(call("finish", "{}") + "," + call("finish", "{}"), "", new AtomicReference<>());
    assertNotNull(plan().error());
  }

  @Test
  void strictArgumentsRejectAuthorityAndMalformedInputs() throws Exception {
    var g = gateway();
    for (String input :
        List.of(
            "{\"query\":\"a\",\"query\":\"b\"}",
            "{\"query\":\"a\",\"userId\":\"victim\"}",
            "{\"query\":1}",
            "[]",
            "{}",
            "{\"query\":\"a\"} {}"))
      assertThrows(Exception.class, () -> g.validate("search", input), input);
    assertThrows(Exception.class, () -> g.validate("shell", "{}"));
    assertThrows(
        Exception.class,
        () -> g.validate("neighbors", "{\"evidenceHandle\":\"E1\",\"direction\":\"all\"}"));
    assertThrows(
        Exception.class,
        () -> g.validate("search", json.writeValueAsString(Map.of("query", "a".repeat(4001)))));
    assertEquals(
        Map.of("evidenceHandle", "E1"),
        g.validate("inspectCitation", "{\"evidenceHandle\":\"E1\"}"));
  }

  @Test
  void duplicateFieldsInActualToolResponseAreRejectedWithActualUsage() throws Exception {
    tools(
        call("search", "{\"query\":\"a\",\"query\":\"b\"}"),
        ",\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}",
        new AtomicReference<>());
    var result = plan();
    assertNotNull(result.error());
    assertEquals(3L, result.promptTokens());
    assertNull(result.toolName());
  }

  @Test
  void unknownToolIsNotExecuted() throws Exception {
    tools(call("executeShell", "{}"), "", new AtomicReference<>());
    assertNotNull(plan().error());
  }

  @Test
  void duplicateOuterResponseFieldIsRejected() throws Exception {
    response(
        200,
        "{\"choices\":[],\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"tool_calls\":["
            + call("finish", "{}")
            + "]},\"finish_reason\":\"tool_calls\"}]}",
        new AtomicReference<>());
    assertNotNull(plan().error());
  }

  @Test
  void malformedAndOversizedCallsAreRejected() throws Exception {
    tools(call("search", "{\"query\":\"" + "a".repeat(5001) + "\"}"), "", new AtomicReference<>());
    assertNotNull(plan().error());
  }

  @Test
  void rateLimitAndNoUsageAreExplicitFailure() {
    response(429, "{\"error\":{\"message\":\"fixture\"}}", new AtomicReference<>());
    var result = plan();
    assertNotNull(result.error());
    assertNull(result.promptTokens());
  }

  @Test
  void actualNetworkTimeoutHasTotalDeadline() {
    server.createContext(
        "/v1/chat/completions",
        x -> {
          try {
            Thread.sleep(2200);
          } catch (InterruptedException ignored) {
          }
          x.close();
        });
    long start = System.nanoTime();
    assertNotNull(plan().error());
    assertTrue((System.nanoTime() - start) / 1_000_000 < 1800);
  }

  @Test
  void boundedGenerationSendsActualMaxTokensAndPreservesPrompt() throws Exception {
    var request = new AtomicReference<String>();
    response(
        200,
        "{\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"data"
            + " [E1]\"},\"finish_reason\":\"stop\"}]}",
        request);
    var g = new SpringAiGateway(base, "fixture", "chat", base, "fixture", "embed", 5);
    var evidence = List.of(new Evidence("E1", "d", "n", "v", 1, 1, 0, 4, "data", 1));
    assertNull(g.generate("q", evidence).error());
    var original = json.readTree(request.get());
    assertNull(g.generateBounded("q", evidence, 77, 1).error());
    var bounded = json.readTree(request.get());
    assertEquals(original.get("messages"), bounded.get("messages"));
    assertFalse(original.has("max_tokens"));
    assertEquals(77, bounded.get("max_tokens").asInt());
  }

  @Test
  void boundedTruncationWithValidCitationIsFailureAndPreservesUsage() throws Exception {
    response(
        200,
        "{\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"data"
            + " [E1]\"},\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":7,\"total_tokens\":16}}",
        new AtomicReference<>());
    var g = new SpringAiGateway(base, "fixture", "chat", base, "fixture", "embed", 5);
    var evidence = List.of(new Evidence("E1", "d", "n", "v", 1, 1, 0, 4, "data", 1));
    assertNull(g.generate("q", evidence).error());
    var bounded = g.generateBounded("q", evidence, 7, 1);
    assertEquals("OUTPUT_LIMIT", bounded.error());
    assertEquals(9L, bounded.promptTokens());
    assertEquals(7L, bounded.completionTokens());
  }

  @Test
  void plannerTruncationPreservesUsageAndIsOutputLimit() throws Exception {
    response(
        200,
        "{\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"tool_calls\":["
            + call("finish", "{}")
            + "]},\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}",
        new AtomicReference<>());
    var result = plan();
    assertEquals("OUTPUT_LIMIT", result.error());
    assertEquals(5L, result.promptTokens());
    assertEquals(2L, result.completionTokens());
    assertNull(result.toolName());
  }
}
