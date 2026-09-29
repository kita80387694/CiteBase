package citebase.processharness;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.citebase.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletionException;
import java.util.regex.Pattern;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

/** Test-classpath-only, fixed-loopback fault adapter. Never a real model or quality benchmark. */
public final class ProcessWorkerApplication {
  private static final URI GATE = URI.create("http://127.0.0.1:39555/gate");
  private static final Pattern MARKER = Pattern.compile("P4_GATE_[A-Z0-9_]{1,60}");

  public static void main(String[] args) {
    Map<String, String> supplied = new HashMap<>();
    for (String arg : args) {
      int split = arg.indexOf('=');
      if (arg.startsWith("--") && split > 2) supplied.put(arg.substring(2, split), arg.substring(split + 1));
    }
    String url = supplied.getOrDefault("spring.datasource.url", "");
    if (!url.matches("jdbc:postgresql://127\\.0\\.0\\.1:25435/phase4_process_[0-9]+"))
      throw new IllegalArgumentException("Harness requires a new phase4_process_<timestamp> database at fixed loopback port 25435");
    if (!"mock".equals(supplied.get("MODEL_MODE"))
        || !"127.0.0.1".equals(supplied.get("server.address"))
        || !Set.of("28083", "28084").contains(supplied.get("server.port")))
      throw new IllegalArgumentException("Harness accepts explicit mock mode and loopback ports 28083/28084 only");
    String label = supplied.getOrDefault("HARNESS_PROCESS_LABEL", "");
    if (!Set.of("A", "B").contains(label)) throw new IllegalArgumentException("Harness label must be A/B");
    var context = new SpringApplicationBuilder(Application.class, ProcessConfiguration.class).run(args);
    System.out.println("PROCESS_HARNESS_READY label=" + label + " pid=" + ProcessHandle.current().pid()
        + " workerId=" + context.getBean(TaskWorker.class).workerId() + " mode=mock/fault");
  }

  @TestConfiguration(proxyBeanMethods = false)
  public static class ProcessConfiguration {
    @Bean @Primary ModelGateway processModelGateway(Environment env, ObjectMapper mapper) {
      return new ControlledModel(env.getProperty("HARNESS_PROCESS_LABEL"), mapper);
    }
    @Bean @Primary AgentPlannerGateway processPlannerGateway(Environment env, ObjectMapper mapper) {
      var gate = new GateClient(env.getProperty("HARNESS_PROCESS_LABEL"), mapper);
      return new AgentPlannerGateway() {
        private final MockAgentPlannerGateway delegate = new MockAgentPlannerGateway();
        public AgentDecision plan(String question, List<Evidence> evidence, List<Map<String,Object>> actions, int output, int timeout) {
          gate.await("planner", question);
          return delegate.plan(question, evidence, actions, output, timeout);
        }
        public Map<String,Object> configuration() {
          return Map.of("provider", "test-only-fixed-loopback-gate", "model", "mock-finish-v1", "externalNetwork", true, "qualityEvidence", false);
        }
      };
    }
    @Bean HarnessController processHarnessController(JdbcTemplate db, TaskWorker worker, Environment env) {
      return new HarnessController(db, worker, env.getProperty("HARNESS_PROCESS_LABEL"));
    }
  }

  static final class ControlledModel extends MockModelGateway {
    private final GateClient gate;
    ControlledModel(String label, ObjectMapper mapper) { gate = new GateClient(label, mapper); }
    @Override public float[] embed(String text) { gate.await("embedding", text); return super.embed(text); }
    @Override public Generation generate(String question, List<Evidence> evidence) {
      gate.await("generation", question);
      return super.generate(question, evidence);
    }
    @Override public String chatModel() { return "mock-process-gated-extract-v1"; }
    @Override public Map<String,Object> configuration() {
      return Map.of("provider", "test-only-fixed-loopback-gate", "modelMode", "mock", "externalNetwork", true, "qualityEvidence", false);
    }
  }

  static final class GateClient {
    private final String label;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    GateClient(String label, ObjectMapper mapper) { this.label = label; this.mapper = mapper; }
    void await(String operation, String input) {
      var task = TaskContext.current();
      var lease = task == null ? null : task.lease();
      var receipt = new LinkedHashMap<String,Object>();
      receipt.put("operation", operation); receipt.put("process", label);
      receipt.put("pid", ProcessHandle.current().pid());
      var marker = MARKER.matcher(input);
      receipt.put("marker", marker.find() ? marker.group() : "UNMARKED");
      receipt.put("inputHash", AuthService.hash(input.getBytes(StandardCharsets.UTF_8)));
      receipt.put("taskId", lease == null ? null : lease.taskId());
      receipt.put("workerId", lease == null ? null : lease.workerId());
      receipt.put("generation", lease == null ? null : lease.fencingToken());
      try {
        var request = HttpRequest.newBuilder(GATE).timeout(Duration.ofSeconds(180))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(receipt))).build();
        // join deliberately does not complete on Thread.interrupt(): exercises late provider returns.
        var response = http.sendAsync(request, HttpResponse.BodyHandlers.ofString()).join();
        if (response.statusCode() != 200) throw new SpringAiGateway.ModelFailure(ProviderFailures.fromStatus(response.statusCode()), null);
      } catch (TaskSignal | SpringAiGateway.ModelFailure e) { throw e; }
      catch (Exception e) {
        Throwable cause = e instanceof CompletionException && e.getCause() != null ? e.getCause() : e;
        throw new SpringAiGateway.ModelFailure("PROVIDER_UNAVAILABLE", cause);
      }
    }
  }

  /** No production registration: only an explicit test configuration creates this controller. */
  @RestController
  public static final class HarnessController {
    private final JdbcTemplate db; private final TaskWorker worker; private final String label;
    HarnessController(JdbcTemplate db, TaskWorker worker, String label) { this.db = db; this.worker = worker; this.label = label; }
    @GetMapping("/__process-test/identity") public Map<String,Object> identity() {
      return Map.of("process", label, "pid", ProcessHandle.current().pid(), "workerId", worker.workerId(),
          "database", db.queryForObject("select current_database()", String.class),
          "postgres", db.queryForObject("select version()", String.class), "modelMode", "mock/fault-test-only");
    }
    @GetMapping("/__process-test/tasks/{id}") public Map<String,Object> state(@PathVariable String id) {
      requireId(id);
      var out = new LinkedHashMap<String,Object>();
      out.put("task", db.queryForList("select id,kind,status,attempts,fencing_token,lease_owner,lease_until,error_code from work_task where id=?", id));
      var items = db.queryForList("select case_id,mode,status,attempts,result from evaluation_item where evaluation_id=? order by ordinal", id);
      for (var row : items) { Object raw = row.remove("result"); row.put("resultHash", raw == null ? null : AuthService.hash(raw.toString().getBytes(StandardCharsets.UTF_8))); }
      out.put("items", items);
      out.put("calls", db.queryForList("select call_id,operation_key,fencing_token,status,usage,outcome from work_call where task_id=? order by started_at,call_id", id));
      out.put("stageParts", db.queryForObject("select count(*) from index_chunk_stage where task_id=?", Integer.class, id));
      out.put("chunks", db.queryForList("select c.id,c.version_id,c.start_offset,c.end_offset from chunk c join index_task t on t.version_id=c.version_id where t.id=? order by c.id", id));
      return out;
    }
    @PostMapping("/__process-test/tasks/{id}/expire") public Map<String,Object> expire(@PathVariable String id) {
      requireId(id);
      int changed = db.update("update work_task set lease_until=clock_timestamp()-interval '1 second' where id=? and status='RUNNING'", id);
      return Map.of("expired", changed, "testOnly", true);
    }
    private void requireId(String id) { if (!id.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException("Generated task UUID required"); }
  }
}
