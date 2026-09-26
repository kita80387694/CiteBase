package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class RagController {
  private final AuthService auth;
  private final QuestionService questions;
  private final RetrievalService retrieval;
  private final EvaluationService evaluations;

  public RagController(
      AuthService auth,
      QuestionService questions,
      RetrievalService retrieval,
      EvaluationService evaluations) {
    this.auth = auth;
    this.questions = questions;
    this.retrieval = retrieval;
    this.evaluations = evaluations;
  }

  public record Ask(String kbId, String question, String mode, Integer topK) {}

  @PostMapping("/questions")
  public QuestionResult ask(@RequestBody Ask body, HttpServletRequest req) {
    return questions.ask(
        auth.require(req),
        body.kbId(),
        body.question(),
        body.mode() == null ? "vector" : body.mode(),
        body.topK() == null ? 5 : body.topK(),
        true);
  }

  @GetMapping("/questions")
  public List<Object> history(@RequestParam String kbId, HttpServletRequest req) {
    return questions.history(auth.require(req), kbId);
  }

  @GetMapping("/citations/{id}")
  public Evidence citation(@PathVariable String id, HttpServletRequest req) {
    return retrieval.citation(auth.require(req), id);
  }

  @PostMapping("/evaluations")
  public Object run(@RequestBody EvaluationService.Request body, HttpServletRequest req) {
    return evaluations.run(auth.require(req), body);
  }

  @GetMapping("/evaluations")
  public Object list(HttpServletRequest req) {
    return evaluations.list(auth.require(req));
  }

  @GetMapping("/evaluations/{id}")
  public Object get(@PathVariable String id, HttpServletRequest req) {
    return evaluations.get(auth.require(req), id);
  }

  @GetMapping("/evaluations/{id}/export")
  public ResponseEntity<Object> export(@PathVariable String id, HttpServletRequest req) {
    return ResponseEntity.ok()
        .header(
            HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"citebase-evaluation.json\"")
        .contentType(MediaType.APPLICATION_JSON)
        .body(evaluations.get(auth.require(req), id));
  }
}
