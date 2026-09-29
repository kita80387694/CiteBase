package io.citebase;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class EvaluationScoringService {
  public record Request(
      String caseId,
      String mode,
      Boolean answerCorrect,
      String source,
      String rationale,
      String ruleVersion,
      Boolean citationSupported,
      List<String> errorCategories) {}

  public static final Set<String> CATEGORIES =
      Set.of(
          "retrieval_miss",
          "ranking_poor",
          "unsupported_answer",
          "contradiction",
          "unsupported_citation",
          "correct_abstention",
          "incorrect_abstention");
  private final JdbcTemplate db;
  private final QuestionService json;

  public EvaluationScoringService(JdbcTemplate db, QuestionService json) {
    this.db = db;
    this.json = json;
  }

  @Transactional
  public Map<String, Object> score(String user, String id, Request request) {
    var bases =
        db.queryForList(
            "SELECT kb_id,task_id FROM evaluation_run WHERE id=? AND user_id=?", id, user);
    if (bases.isEmpty()) throw AccessService.missing();
    db.queryForList(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))",
        bases.getFirst().get("kb_id"));
    if (bases.getFirst().get("task_id") != null)
      db.queryForList("SELECT id FROM work_task WHERE id=? FOR UPDATE", id);
    var runs =
        db.queryForList(
            "SELECT status,payload,task_id FROM evaluation_run WHERE id=? AND user_id=? FOR UPDATE",
            id,
            user);
    if (runs.isEmpty()) throw AccessService.missing();
    if (Set.of("QUEUED", "RUNNING", "RETRY_WAIT", "CANCEL_REQUESTED")
        .contains(runs.getFirst().get("status")))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "评测尚未结束");
    if (request == null
        || request.answerCorrect() == null
        || !"human".equals(request.source())
        || request.caseId() == null
        || request.mode() == null
        || !Set.of("vector", "hybrid").contains(request.mode())
        || request.rationale() == null
        || request.rationale().isBlank()
        || request.rationale().length() > 4000
        || request.ruleVersion() == null
        || request.ruleVersion().isBlank()
        || request.ruleVersion().length() > 100
        || request.errorCategories() == null
        || new HashSet<>(request.errorCategories()).size() != request.errorCategories().size()
        || !CATEGORIES.containsAll(request.errorCategories()))
      throw new IllegalArgumentException("人工评分字段无效");
    var payload = (Map<?, ?>) json.decode(runs.getFirst().get("payload").toString());
    List<?> rows = (List<?>) payload.getOrDefault("results", null);
    if (runs.getFirst().get("task_id") != null)
      rows =
          db.query(
              "SELECT result::text FROM evaluation_item WHERE evaluation_id=? AND status IN"
                  + " ('SUCCEEDED','FAILED') AND result IS NOT NULL",
              (rs, n) -> json.decode(rs.getString(1)),
              id);
    if (rows == null
        || rows.stream()
            .noneMatch(
                row ->
                    row instanceof Map<?, ?> r
                        && request.caseId().equals(r.get("caseId"))
                        && request.mode().equals(r.get("mode"))))
      throw new IllegalArgumentException("评分目标不存在");
    String scoreId = UUID.randomUUID().toString();
    db.update(
        "INSERT INTO"
            + " evaluation_score(id,evaluation_id,case_id,retrieval_mode,answer_correct,source,rationale,rule_version,scored_by,citation_supported,error_categories)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?::jsonb)",
        scoreId,
        id,
        request.caseId(),
        request.mode(),
        request.answerCorrect(),
        request.source(),
        request.rationale(),
        request.ruleVersion(),
        user,
        request.citationSupported(),
        json.encode(request.errorCategories()));
    if (runs.getFirst().get("task_id") != null) {
      var result =
          db.queryForObject(
              "SELECT result::text FROM evaluation_item WHERE evaluation_id=? AND case_id=? AND"
                  + " mode=?",
              String.class,
              id,
              request.caseId(),
              request.mode());
      db.update(
          "UPDATE evaluation_score SET result_digest=? WHERE id=?",
          AuthService.hash(result.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
          scoreId);
    }
    return scores(user, id).stream()
        .filter(s -> scoreId.equals(s.get("id")))
        .findFirst()
        .orElseThrow();
  }

  public List<Map<String, Object>> scores(String user, String id) {
    return db.query(
        "SELECT s.* FROM evaluation_score s JOIN evaluation_run r ON r.id=s.evaluation_id WHERE"
            + " r.id=? AND r.user_id=? ORDER BY s.sequence_id",
        (rs, n) -> {
          var score = new LinkedHashMap<String, Object>();
          score.put("id", rs.getString("id"));
          score.put("caseId", rs.getString("case_id"));
          score.put("mode", rs.getString("retrieval_mode"));
          score.put("answerCorrect", rs.getBoolean("answer_correct"));
          score.put("source", rs.getString("source"));
          score.put("rationale", rs.getString("rationale"));
          score.put("ruleVersion", rs.getString("rule_version"));
          score.put("resultDigest", rs.getString("result_digest"));
          score.put("scoredBy", rs.getString("scored_by"));
          score.put("scoredAt", rs.getTimestamp("scored_at").toInstant().toString());
          score.put("citationSupported", rs.getObject("citation_supported"));
          score.put("errorCategories", json.decode(rs.getString("error_categories")));
          return score;
        },
        id,
        user);
  }

  @SuppressWarnings("unchecked")
  public Object overlay(String user, String id, Object value) {
    var payload = (Map<String, Object>) value;
    var scores = scores(user, id);
    payload.put("manualScores", scores);
    var latest = new HashMap<String, Map<String, Object>>();
    for (var score : scores) latest.put(score.get("caseId") + "\u0000" + score.get("mode"), score);
    if (payload.get("results") instanceof List<?> rows)
      for (var row : rows) {
        var r = (Map<String, Object>) row;
        r.put("manualScore", latest.get(r.get("caseId") + "\u0000" + r.get("mode")));
      }
    return payload;
  }
}
