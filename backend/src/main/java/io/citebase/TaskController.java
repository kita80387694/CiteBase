package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/tasks")
public class TaskController {
  private final TaskRepository tasks;
  private final AuthService auth;

  public TaskController(TaskRepository tasks, AuthService auth) {
    this.tasks = tasks;
    this.auth = auth;
  }

  @GetMapping
  Object list(
      HttpServletRequest req,
      @RequestParam(required = false) String kbId,
      @RequestParam(required = false) TaskKind kind) {
    return tasks.list(auth.require(req), kbId, kind);
  }

  @GetMapping("/{id}")
  Object get(HttpServletRequest req, @PathVariable String id) {
    return tasks.get(auth.require(req), id);
  }

  @PostMapping("/{id}/cancel")
  Object cancel(HttpServletRequest req, @PathVariable String id) {
    return tasks.cancel(auth.require(req), id);
  }

  @PostMapping("/{id}/retry")
  Object retry(HttpServletRequest req, @PathVariable String id) {
    return tasks.retry(auth.require(req), id);
  }
}
