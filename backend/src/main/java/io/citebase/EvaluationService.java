package io.citebase;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class EvaluationService {
  public record Case(
      String id,
      String question,
      boolean answerable,
      String expectedAnswer,
      List<EvaluationMetrics.Label> evidence) {}

  public record Dataset(String version, List<Case> questions) {}

  public record Request(String kbId, String name, Dataset dataset, Integer topK) {}

  private final JdbcTemplate db;
  private final QuestionService questions;
  private final AccessService access;
  private final ObjectMapper mapper;
  private final ModelGateway model;
  private final org.springframework.transaction.support.TransactionTemplate progressTransaction;

  public EvaluationService(
      JdbcTemplate db,
      QuestionService questions,
      AccessService access,
      ObjectMapper mapper,
      ModelGateway model,
      org.springframework.transaction.PlatformTransactionManager transactionManager) {
    this.db = db;
    this.questions = questions;
    this.access = access;
    this.mapper = mapper;
    this.model = model;
    progressTransaction =
        new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    progressTransaction.setPropagationBehavior(
        org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recover() {
    db.update(
        "UPDATE evaluation_run SET"
            + " status='FAILED',payload=jsonb_set(jsonb_set(payload,'{status}','\"FAILED\"'),'{error}','\"进程中断，请重新创建评测\"')"
            + " WHERE status='RUNNING'");
  }

  @org.springframework.transaction.annotation.Transactional
  public Map<String, Object> run(String user, Request request) {
    db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", request.kbId());
    access.requireKnowledgeBase(user, request.kbId());
    int k = request.topK() == null ? 5 : request.topK();
    if (k < 1
        || k > 20
        || request.name() == null
        || request.name().isBlank()
        || request.name().length() > 120) throw new IllegalArgumentException("名称或 topK 无效");
    Dataset dataset = request.dataset();
    if (dataset == null
        || dataset.version() == null
        || dataset.version().isBlank()
        || dataset.questions() == null
        || dataset.questions().isEmpty()
        || dataset.questions().size() > 200)
      throw new IllegalArgumentException("评测集须含版本及 1–200 道题");
    Set<String> ids = new HashSet<>();
    for (Case c : dataset.questions()) {
      if (c.id() == null
          || !ids.add(c.id())
          || c.question() == null
          || c.question().isBlank()
          || c.evidence() == null
          || (c.answerable() && c.evidence().isEmpty()))
        throw new IllegalArgumentException("题目 id 须唯一，可回答题须有证据标注");
      for (var label : c.evidence())
        if (label.documentName() == null || label.quote() == null || label.quote().isBlank())
          throw new IllegalArgumentException("证据须提供 documentName 和 quote");
    }
    String id = UUID.randomUUID().toString();
    var run = new LinkedHashMap<String, Object>();
    run.put("id", id);
    run.put("name", request.name());
    run.put("status", "RUNNING");
    run.put("modelMode", model.mode());
    run.put("createdAt", Instant.now().toString());
    run.put("error", null);
    var config = new LinkedHashMap<>(questions.config(k));
    config.put("dataset", dataset);
    config.put(
        "dataVersions",
        db.queryForList(
            "SELECT d.id,d.name,v.id version_id,v.content_hash FROM document d JOIN"
                + " document_version v ON v.id=d.active_version_id JOIN knowledge_base kb ON"
                + " kb.id=d.kb_id WHERE kb.user_id=? AND kb.id=? ORDER BY d.id",
            user,
            request.kbId()));
    run.put("config", config);
    run.put("summary", Map.of());
    var results = new ArrayList<Map<String, Object>>();
    run.put("results", results);
    persist(
        "INSERT INTO evaluation_run(id,user_id,kb_id,name,status,payload)"
            + " VALUES(?,?,?,?,'RUNNING',?::jsonb)",
        id,
        user,
        request.kbId(),
        request.name(),
        questions.encode(run));
    try {
      for (Case c : dataset.questions())
        for (String mode : List.of("vector", "hybrid")) {
          var answer = questions.ask(user, request.kbId(), c.question(), mode, k, false);
          Map<String, Object> row =
              mapper.convertValue(answer, new TypeReference<LinkedHashMap<String, Object>>() {});
          var score = EvaluationMetrics.compute(c.evidence(), answer.evidence());
          row.put("caseId", c.id());
          row.put("expectedAnswer", c.expectedAnswer());
          row.put("answerable", c.answerable());
          row.put("expectedEvidence", c.evidence());
          row.put("recallAtK", c.answerable() ? score.recallAtK() : null);
          row.put("mrr", c.answerable() ? score.mrr() : null);
          row.put("evidenceHit", score.evidenceHit());
          // Exact normalized reference containment is deliberately reported separately from human
          // semantic correctness.
          row.put("answerCorrect", null);
          row.put(
              "referenceAnswerMatch",
              c.expectedAnswer() == null
                  ? null
                  : normalize(answer.answer()).contains(normalize(c.expectedAnswer())));
          row.put("abstentionCorrect", !c.answerable() ? answer.abstained() : null);
          results.add(row);
          persist(
              "UPDATE evaluation_run SET payload=?::jsonb WHERE id=? AND user_id=?",
              questions.encode(run),
              id,
              user);
        }
      var summary = new LinkedHashMap<String, Object>();
      for (String mode : List.of("vector", "hybrid")) {
        var rows = results.stream().filter(r -> mode.equals(r.get("mode"))).toList();
        var metrics = new LinkedHashMap<String, Object>();
        metrics.put("count", rows.size());
        metrics.put(
            "answerableCount",
            rows.stream().filter(r -> Boolean.TRUE.equals(r.get("answerable"))).count());
        for (String key : List.of("recallAtK", "mrr", "retrievalMs", "totalMs"))
          metrics.put(
              key,
              rows.stream()
                  .map(r -> r.get(key))
                  .filter(Objects::nonNull)
                  .mapToDouble(v -> ((Number) v).doubleValue())
                  .average()
                  .stream()
                  .boxed()
                  .findFirst()
                  .orElse(null));
        metrics.put("errorCount", rows.stream().filter(r -> r.get("error") != null).count());
        summary.put(mode, metrics);
      }
      run.put("summary", summary);
      run.put("status", "COMPLETED");
      if (results.stream().anyMatch(r -> r.get("error") != null)) {
        run.put("status", "COMPLETED_WITH_ERRORS");
        run.put("error", "部分题目失败，请查看逐题原因；失败题未排除出指标");
      }
    } catch (Exception e) {
      run.put("status", "FAILED");
      run.put("error", "评测执行失败，请检查文档、模型服务与数据库配置");
    }
    persist(
        "UPDATE evaluation_run SET status=?,payload=?::jsonb WHERE id=? AND user_id=?",
        run.get("status"),
        questions.encode(run),
        id,
        user);
    return run;
  }

  private void persist(String sql, Object... args) {
    progressTransaction.executeWithoutResult(status -> db.update(sql, args));
  }

  private static String normalize(String s) {
    return s.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
  }

  public List<Object> list(String user) {
    return db.query(
        "SELECT payload-'results'-'config' FROM evaluation_run WHERE user_id=? ORDER BY created_at"
            + " DESC LIMIT 100",
        (r, n) -> questions.decode(r.getString(1)),
        user);
  }

  public Object get(String user, String id) {
    var rows =
        db.query(
            "SELECT payload FROM evaluation_run WHERE user_id=? AND id=?",
            (r, n) -> questions.decode(r.getString(1)),
            user,
            id);
    if (rows.isEmpty())
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.NOT_FOUND, "评测不存在或无权限");
    return rows.getFirst();
  }
}
