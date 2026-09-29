package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/agent-runs")
public class AgentController {
  private final AuthService auth;
  private final AgentInput input;
  private final AgentRunRepository runs;
  private final AgentService service;

  public AgentController(
      AuthService auth, AgentInput input, AgentRunRepository runs, AgentService service) {
    this.auth = auth;
    this.input = input;
    this.runs = runs;
    this.service = service;
  }

  @PostMapping
  public Object create(@RequestBody String body, HttpServletRequest req) {
    return runs.create(auth.require(req), input.parse(body));
  }

  @PostMapping("/{id}/execute")
  public Object execute(@PathVariable String id, HttpServletRequest req) {
    return service.execute(auth.require(req), id);
  }

  @PostMapping("/{id}/cancel")
  public Object cancel(@PathVariable String id, HttpServletRequest req) {
    return runs.cancel(auth.require(req), id);
  }

  @GetMapping("/{id}")
  public Object get(@PathVariable String id, HttpServletRequest req) {
    return runs.get(auth.require(req), id);
  }

  @GetMapping
  public Object list(@RequestParam String kbId, HttpServletRequest req) {
    return runs.list(auth.require(req), kbId);
  }

  @GetMapping("/{id}/export")
  public ResponseEntity<Object> export(@PathVariable String id, HttpServletRequest req) {
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"citebase-agent.json\"")
        .body(runs.get(auth.require(req), id));
  }
}
