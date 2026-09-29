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
  private final EvaluationInput evaluationInput;
  private final EvaluationScoringService scoring;

  public RagController(
      AuthService auth,
      QuestionService questions,
      RetrievalService retrieval,
      EvaluationService evaluations,
      EvaluationInput evaluationInput,
      EvaluationScoringService scoring) {
    this.auth = auth;
    this.questions = questions;
    this.retrieval = retrieval;
    this.evaluations = evaluations;
    this.evaluationInput = evaluationInput;
    this.scoring = scoring;
  }

  public record Ask(
      String kbId, String question, String mode, Integer topK, RetrievalOptions retrievalOptions) {
    public Ask(String kbId, String question, String mode, Integer topK) {
      this(kbId, question, mode, topK, null);
    }
  }

  @PostMapping("/questions")
  public QuestionResult ask(@RequestBody String source, HttpServletRequest req) {
    String user = auth.require(req);
    var body = evaluationInput.ask(source);
    return questions.ask(
        user,
        body.kbId(),
        body.question(),
        body.mode() == null ? "vector" : body.mode(),
        body.topK() == null ? 5 : body.topK(),
        true,
        body.retrievalOptions());
  }

  @PostMapping("/retrieval-diagnostics")
  public Object diagnose(@RequestBody String source, HttpServletRequest req) {
    String user = auth.require(req);
    var body = evaluationInput.ask(source);
    return questions.diagnose(
        user,
        body.kbId(),
        body.question(),
        body.mode() == null ? "vector" : body.mode(),
        body.topK() == null ? 5 : body.topK(),
        body.retrievalOptions());
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
  public Object run(@RequestBody String body, HttpServletRequest req) {
    String user = auth.require(req);
    try {
      return ResponseEntity.accepted()
          .body(evaluations.create(user, evaluationInput.request(body)));
    } catch (IllegalArgumentException e) {
      throw new org.springframework.web.server.ResponseStatusException(
          HttpStatus.BAD_REQUEST, e.getMessage());
    }
  }

  @PostMapping("/evaluations/{id}/scores")
  public Object score(@PathVariable String id, @RequestBody String body, HttpServletRequest req) {
    String user = auth.require(req);
    try {
      return scoring.score(user, id, evaluationInput.score(body));
    } catch (IllegalArgumentException e) {
      throw new org.springframework.web.server.ResponseStatusException(
          HttpStatus.BAD_REQUEST, e.getMessage());
    }
  }

  @GetMapping("/evaluations")
  public Object list(HttpServletRequest req) {
    return evaluations.list(auth.require(req));
  }

  @GetMapping("/evaluations/{id}")
  public Object get(@PathVariable String id, HttpServletRequest req) {
    return evaluations.get(auth.require(req), id);
  }

  @GetMapping("/evaluations/{id}/citations/{chunkId}")
  public Evidence evaluationCitation(
      @PathVariable String id, @PathVariable String chunkId, HttpServletRequest req) {
    return retrieval.evaluationCitation(auth.require(req), id, chunkId);
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
