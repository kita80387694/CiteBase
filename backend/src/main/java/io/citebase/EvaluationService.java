package io.citebase;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class EvaluationService implements TaskHandler {
  public static final String METRIC_DEFINITION_VERSION =
      "grouped-evidence-v2-error-aware-abstention";

  public record Case(
      String id,
      String question,
      boolean answerable,
      String expectedAnswer,
      List<EvaluationMetrics.Label> evidence,
      String category,
      String split,
      String group,
      String topic) {
    public Case(
        String id,
        String question,
        boolean answerable,
        String expectedAnswer,
        List<EvaluationMetrics.Label> evidence) {
      this(id, question, answerable, expectedAnswer, evidence, null, null, null, null);
    }
  }

  public record Dataset(String version, List<Case> questions, Integer seed, String split) {
    public Dataset(String version, List<Case> questions) {
      this(version, questions, null, null);
    }
  }

  public record Request(
      String kbId,
      String name,
      Dataset dataset,
      Integer topK,
      RetrievalOptions retrievalOptions,
      String idempotencyKey) {
    public Request(
        String kbId, String name, Dataset dataset, Integer topK, RetrievalOptions options) {
      this(kbId, name, dataset, topK, options, UUID.randomUUID().toString());
    }

    public Request(String kbId, String name, Dataset dataset, Integer topK) {
      this(kbId, name, dataset, topK, null, UUID.randomUUID().toString());
    }
  }

  private final JdbcTemplate db;
  private final QuestionService questions;
  private final AccessService access;
  private final ObjectMapper mapper;
  private final ModelGateway model;
  private final EvaluationLabels labels;
  private final EvaluationScoringService scoring;
  private final RetrievalService retrieval;
  private final TaskRepository tasks;
  private final TransactionTemplate tx;
  private final int itemMaxAttempts;
  private final int taskMaxAttempts;

  public EvaluationService(
      JdbcTemplate db,
      QuestionService questions,
      AccessService access,
      ObjectMapper mapper,
      ModelGateway model,
      EvaluationLabels labels,
      EvaluationScoringService scoring,
      RetrievalService retrieval,
      TaskRepository tasks,
      org.springframework.transaction.PlatformTransactionManager tm,
      @org.springframework.beans.factory.annotation.Value(
              "${EVALUATION_ITEM_MAX_ATTEMPTS:${citebase.evaluation-item-max-attempts:2}}")
          int itemMaxAttempts,
      @org.springframework.beans.factory.annotation.Value("${EVALUATION_TASK_MAX_ATTEMPTS:5}")
          int taskMaxAttempts) {
    this.db = db;
    this.questions = questions;
    this.access = access;
    this.mapper = mapper;
    this.model = model;
    this.labels = labels;
    this.scoring = scoring;
    this.retrieval = retrieval;
    this.tasks = tasks;
    this.tx = new TransactionTemplate(tm);
    if (itemMaxAttempts < 1 || itemMaxAttempts > 5)
      throw new IllegalArgumentException("evaluation item retry cap must be1..5");
    this.itemMaxAttempts = itemMaxAttempts;
    if (taskMaxAttempts < 1 || taskMaxAttempts > 10)
      throw new IllegalArgumentException("evaluation task retry cap must be 1..10");
    this.taskMaxAttempts = taskMaxAttempts;
  }

  public TaskKind kind() {
    return TaskKind.EVALUATION;
  }

  public TaskLock publicationLock() {
    return TaskLock.SHARED_SOURCE;
  }

  /** Legacy callers now create durable tasks; no network calls occur here. */
  public Map<String, Object> run(String user, Request request) {
    return create(user, request);
  }

  public Map<String, Object> create(String user, Request request) {
    if (request == null
        || request.name() == null
        || request.name().isBlank()
        || request.name().length() > 120
        || request.idempotencyKey() == null
        || request.idempotencyKey().isBlank()
        || request.idempotencyKey().length() > 100)
      throw new IllegalArgumentException("名称或幂等key无效");
    int k = request.topK() == null ? 5 : request.topK();
    if (k < 1 || k > 20) throw new IllegalArgumentException("topK无效");
    var options = RetrievalOptions.resolve(request.retrievalOptions(), k);
    var normalized =
        new Request(
            request.kbId(),
            request.name(),
            request.dataset(),
            k,
            options,
            request.idempotencyKey());
    String hash =
        AuthService.hash(
            questions.encode(normalized).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    var existing = tasks.findExisting(user, kind(), request.idempotencyKey(), hash);
    if (existing.isPresent()) return view(user, Objects.toString(existing.get().get("id")));
    access.requireKnowledgeBase(user, request.kbId());
    var snapshot = retrieval.dataVersions(user, request.kbId());
    Dataset dataset = labels.resolve(user, request.kbId(), request.dataset());
    return tx.execute(
        status -> {
          db.queryForList(
              "SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", request.kbId());
          access.requireKnowledgeBase(user, request.kbId());
          // A second create with the same key must serialize before inserting its domain row.
          db.queryForList(
              "SELECT pg_advisory_xact_lock(hashtextextended(?,1))",
              user + ":" + request.idempotencyKey());
          var prior = tasks.findExisting(user, kind(), request.idempotencyKey(), hash);
          if (prior.isPresent()) return view(user, Objects.toString(prior.get().get("id")));
          if (!snapshot.equals(retrieval.dataVersions(user, request.kbId())))
            throw new ResponseStatusException(
                HttpStatus.CONFLICT, "SOURCE_CHANGED_DURING_VALIDATION");
          String id = UUID.randomUUID().toString();
          var config = new LinkedHashMap<>(questions.config(k, options));
          config.put("dataset", dataset);
          config.put("dataVersions", snapshot);
          config.put("metricDefinitionVersion", METRIC_DEFINITION_VERSION);
          var payload = new LinkedHashMap<String, Object>();
          payload.put("id", id);
          payload.put("name", request.name());
          payload.put("config", config);
          payload.put("modelMode", model.mode());
          payload.put("metricDefinitionVersion", METRIC_DEFINITION_VERSION);
          payload.put("createdAt", Instant.now().toString());
          payload.put("results", List.of());
          db.update(
              "INSERT INTO evaluation_run(id,user_id,kb_id,name,status,payload,normalized_request)"
                  + " VALUES(?,?,?,?,'QUEUED',?::jsonb,?::jsonb)",
              id,
              user,
              request.kbId(),
              request.name(),
              questions.encode(payload),
              questions.encode(normalized));
          for (var source : snapshot)
            db.update(
                "INSERT INTO evaluation_snapshot(evaluation_id,document_id,version_id,metadata)"
                    + " VALUES(?,?,?,?::jsonb)",
                id,
                source.get("id"),
                source.get("version_id"),
                questions.encode(source));
          int ordinal = 0;
          for (var c : dataset.questions())
            for (String mode : List.of("vector", "hybrid"))
              db.update(
                  "INSERT INTO"
                      + " evaluation_item(evaluation_id,case_id,mode,ordinal,case_payload,max_attempts)"
                      + " VALUES(?,?,?,?,?::jsonb,?)",
                  id,
                  c.id(),
                  mode,
                  ordinal++,
                  questions.encode(c),
                  itemMaxAttempts);
          tasks.enqueue(
              new TaskSpec(
                  kind(),
                  user,
                  request.kbId(),
                  id,
                  request.idempotencyKey(),
                  normalized,
                  taskMaxAttempts));
          db.update("UPDATE evaluation_run SET task_id=? WHERE id=?", id, id);
          return view(user, id);
        });
  }

  public TaskResult execute(TaskContext context) {
    var lease = context.lease();
    String id = lease.resourceId();
    tasks.guarded(
        lease,
        publicationLock(),
        sql -> {
          sql.update("UPDATE evaluation_run SET status='RUNNING' WHERE id=?", id);
          sql.update(
              "UPDATE evaluation_attempt SET"
                  + " status='UNKNOWN',error_code='UNKNOWN_EXTERNAL_OUTCOME',finished_at=now()"
                  + " WHERE evaluation_id=? AND status='STARTED' AND fencing_token<>?",
              id,
              lease.fencingToken());
          sql.update(
              "UPDATE evaluation_item SET status='PENDING',error_code='UNKNOWN_EXTERNAL_OUTCOME'"
                  + " WHERE evaluation_id=? AND status='RUNNING' AND fencing_token<>?",
              id,
              lease.fencingToken());
          return null;
        });
    var run = view(lease.userId(), id);
    var config = cast(run.get("config"));
    Request request =
        mapper.convertValue(
            questions.decode(
                db.queryForObject(
                    "SELECT normalized_request::text FROM evaluation_run WHERE id=?",
                    String.class,
                    id)),
            Request.class);
    // Normalize both records and numeric wrapper types through the same JSON round trip as
    // persisted configuration. valueToTree alone retains LongNode versus IntNode identity:
    // e.g. an unchanged TTL of 300L becomes Integer 300 when loaded from JSONB.
    var current =
        cast(
            questions.decode(
                questions.encode(questions.config(request.topK(), request.retrievalOptions()))));
    for (String key : current.keySet()) {
      if (!config.containsKey(key) || !Objects.equals(current.get(key), config.get(key))) {
        throw new TaskSignal("CONFIG_CHANGED");
      }
    }
    while (true) {
      context.checkActive();
      var pending =
          db.queryForList(
              "SELECT *,available_at<=clock_timestamp() AS ready FROM evaluation_item WHERE"
                  + " evaluation_id=? AND status IN ('PENDING','RUNNING') ORDER BY ordinal",
              id);
      if (pending.isEmpty()) break;
      var row =
          pending.stream()
              .filter(r -> Boolean.TRUE.equals(r.get("ready")))
              .findFirst()
              .orElse(null);
      if (row == null) {
        context.defer(Duration.ofSeconds(2));
        throw new IllegalStateException("defer returned");
      }
      var c = mapper.convertValue(questions.decode(row.get("case_payload").toString()), Case.class);
      String mode = row.get("mode").toString();
      if (((Number) row.get("attempts")).intValue()
          >= ((Number) row.get("max_attempts")).intValue()) {
        var failure = failedRow(c, mode, "UNKNOWN_EXTERNAL_OUTCOME", config);
        tasks.guarded(
            lease,
            publicationLock(),
            sql -> {
              sql.update(
                  "UPDATE evaluation_item SET"
                      + " status='FAILED',result=?::jsonb,error_code='UNKNOWN_EXTERNAL_OUTCOME',updated_at=now()"
                      + " WHERE evaluation_id=? AND case_id=? AND mode=?",
                  questions.encode(failure),
                  id,
                  c.id(),
                  mode);
              return null;
            });
        continue;
      }
      String attempt = UUID.randomUUID().toString();
      tasks.guarded(
          lease,
          publicationLock(),
          sql -> {
            sql.update(
                "UPDATE evaluation_item SET"
                    + " status='RUNNING',attempts=attempts+1,fencing_token=?,updated_at=now() WHERE"
                    + " evaluation_id=? AND case_id=? AND mode=?",
                lease.fencingToken(),
                id,
                c.id(),
                mode);
            sql.update(
                "INSERT INTO"
                    + " evaluation_attempt(id,evaluation_id,case_id,mode,attempt_number,fencing_token,status)"
                    + " SELECT ?,evaluation_id,case_id,mode,attempts,?,'STARTED' FROM"
                    + " evaluation_item WHERE evaluation_id=? AND case_id=? AND mode=?",
                attempt,
                lease.fencingToken(),
                id,
                c.id(),
                mode);
            return null;
          });
      QuestionResult answer;
      EvaluationCallScope.bind(attempt);
      try {
        answer =
            questions.askSnapshot(
                lease.userId(),
                lease.kbId(),
                c.question(),
                mode,
                request.topK(),
                request.retrievalOptions(),
                id,
                context);
      } finally {
        EvaluationCallScope.clear();
      }
      var result = graded(c, answer, config);
      boolean retry =
          transientError(answer.error())
              && ((Number) row.get("attempts")).intValue() + 1
                  < ((Number) row.get("max_attempts")).intValue();
      tasks.guarded(
          lease,
          publicationLock(),
          sql -> {
            sql.update(
                "UPDATE evaluation_attempt SET"
                    + " status=?,result=?::jsonb,error_code=?,finished_at=now() WHERE id=? AND"
                    + " fencing_token=?",
                answer.error() == null ? "COMPLETED" : "FAILED",
                questions.encode(result),
                answer.error(),
                attempt,
                lease.fencingToken());
            sql.update(
                "UPDATE evaluation_item SET"
                    + " status=?,result=?::jsonb,error_code=?,available_at=now()+interval '2"
                    + " seconds',updated_at=now() WHERE evaluation_id=? AND case_id=? AND mode=?"
                    + " AND fencing_token=?",
                retry ? "PENDING" : answer.error() == null ? "SUCCEEDED" : "FAILED",
                retry ? null : questions.encode(result),
                answer.error(),
                id,
                c.id(),
                mode,
                lease.fencingToken());
            return null;
          });
      context.progress(progress(id));
    }
    return new TaskResult(Map.of("completed", true));
  }

  private boolean transientError(String error) {
    return ProviderFailures.retryable(error);
  }

  public void publish(JdbcTemplate sql, TaskLease lease, TaskResult result) {
    sql.update("UPDATE evaluation_run SET status='SUCCEEDED' WHERE id=?", lease.resourceId());
  }

  public void onQueued(JdbcTemplate sql, TaskLease metadata) {
    sql.update("UPDATE evaluation_run SET status='QUEUED' WHERE id=?", metadata.resourceId());
    sql.update(
        "UPDATE evaluation_item SET status='PENDING' WHERE evaluation_id=? AND status='CANCELLED'"
            + " AND result IS NULL",
        metadata.resourceId());
  }

  public void onFailure(JdbcTemplate sql, TaskLease lease, TaskFailure failure, TaskState next) {
    sql.update("UPDATE evaluation_run SET status=? WHERE id=?", next.name(), lease.resourceId());
    if (next == TaskState.CANCELLED)
      sql.update(
          "UPDATE evaluation_item SET status='CANCELLED',error_code='CANCELLED' WHERE"
              + " evaluation_id=? AND status IN ('PENDING','RUNNING')",
          lease.resourceId());
    if (next == TaskState.FAILED) {
      var config =
          cast(
              cast(questions.decode(
                      sql.queryForObject(
                          "SELECT payload::text FROM evaluation_run WHERE id=?",
                          String.class,
                          lease.resourceId())))
                  .get("config"));
      for (var item :
          sql.queryForList(
              "SELECT case_id,mode,case_payload FROM evaluation_item WHERE evaluation_id=? AND"
                  + " status IN ('PENDING','RUNNING')",
              lease.resourceId())) {
        var c =
            mapper.convertValue(questions.decode(item.get("case_payload").toString()), Case.class);
        sql.update(
            "UPDATE evaluation_item SET"
                + " status='FAILED',error_code=?,result=?::jsonb,updated_at=now() WHERE"
                + " evaluation_id=? AND case_id=? AND mode=?",
            failure.code(),
            questions.encode(failedRow(c, item.get("mode").toString(), failure.code(), config)),
            lease.resourceId(),
            c.id(),
            item.get("mode"));
      }
      sql.update(
          "UPDATE evaluation_attempt SET"
              + " status='UNKNOWN',error_code='UNKNOWN_EXTERNAL_OUTCOME',finished_at=now() WHERE"
              + " evaluation_id=? AND status='STARTED'",
          lease.resourceId());
    }
  }

  public void validateRetry(JdbcTemplate sql, Map<String, Object> task) {
    String id = Objects.toString(task.get("id"));
    if (sql.queryForObject(
            "SELECT count(*) FROM evaluation_item WHERE evaluation_id=? AND status IN"
                + " ('PENDING','RUNNING','CANCELLED')",
            Integer.class,
            id)
        == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "评测已完成所有题目；重新评测请新建任务");
  }

  private Map<String, Object> graded(Case c, QuestionResult answer, Map<String, Object> config) {
    Map<String, Object> row =
        mapper.convertValue(answer, new TypeReference<LinkedHashMap<String, Object>>() {});
    var hashes = new HashMap<String, String>();
    for (var source : (List<Map<String, Object>>) config.get("dataVersions"))
      hashes.put(source.get("version_id").toString(), source.get("content_hash").toString());
    var score = EvaluationMetrics.compute(c.evidence(), answer.evidence(), hashes);
    int groups = EvaluationMetrics.groups(c.evidence()).size();
    long hits = EvaluationMetrics.hitGroups(c.evidence(), answer.evidence(), hashes);
    row.put("caseId", c.id());
    row.put("category", c.category());
    row.put("split", c.split());
    row.put("group", c.group());
    row.put("topic", c.topic());
    row.put("answerable", c.answerable());
    row.put("expectedAnswer", c.expectedAnswer());
    row.put("expectedEvidence", c.evidence());
    row.put("evidenceGroupCount", groups);
    row.put("hitEvidenceGroupCount", hits);
    row.put("allEvidenceHit", groups > 0 && groups == hits);
    row.put("evidenceHit", score.evidenceHit());
    row.put("recallAtK", c.answerable() ? score.recallAtK() : null);
    row.put("mrr", c.answerable() ? score.mrr() : null);
    row.put("answerCorrect", null);
    row.put(
        "referenceAnswerMatch",
        c.expectedAnswer() == null
            ? null
            : normalize(answer.answer()).contains(normalize(c.expectedAnswer())));
    row.put("abstentionCorrect", abstentionCorrect(c.answerable(), answer));
    return row;
  }

  private Map<String, Object> failedRow(
      Case c, String mode, String error, Map<String, Object> config) {
    var row = new LinkedHashMap<String, Object>();
    row.put("caseId", c.id());
    row.put("question", c.question());
    row.put("mode", mode);
    row.put("modelMode", model.mode());
    row.put("answerable", c.answerable());
    row.put("category", c.category());
    row.put("split", c.split());
    row.put("error", error);
    row.put("answer", Citations.ABSTENTION);
    row.put("abstained", true);
    row.put("citationValid", false);
    row.put("evidence", List.of());
    row.put("citations", List.of());
    row.put("expectedEvidence", c.evidence());
    row.put("expectedAnswer", c.expectedAnswer());
    row.put("group", c.group());
    row.put("topic", c.topic());
    row.put("evidenceGroupCount", EvaluationMetrics.groups(c.evidence()).size());
    row.put("hitEvidenceGroupCount", 0);
    row.put("allEvidenceHit", false);
    row.put("evidenceHit", false);
    row.put("referenceAnswerMatch", c.expectedAnswer() == null ? null : false);
    row.put("retrievalOptions", config.get("retrievalOptions"));
    row.put("answerCorrect", null);
    row.put("recallAtK", c.answerable() ? 0d : null);
    row.put("mrr", c.answerable() ? 0d : null);
    row.put("retrievalMs", null);
    row.put("totalMs", null);
    row.put("promptTokens", null);
    row.put("completionTokens", null);
    row.put("usage", null);
    row.put("abstentionCorrect", c.answerable() ? null : false);
    return row;
  }

  static Boolean abstentionCorrect(boolean answerable, QuestionResult answer) {
    return answerable
        ? null
        : answer.abstained() && answer.error() == null && answer.citationValid();
  }

  private static String normalize(String s) {
    return s.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> cast(Object object) {
    return (Map<String, Object>) object;
  }

  private Map<String, Object> progress(String id) {
    var values =
        db.queryForMap(
            "SELECT count(*) AS total,count(*) FILTER(WHERE status IN ('SUCCEEDED','FAILED')) AS"
                + " completed,count(*) FILTER(WHERE status='FAILED') AS failed FROM evaluation_item"
                + " WHERE evaluation_id=?",
            id);
    values.put("unit", "question_modes");
    return values;
  }

  public List<Object> list(String user) {
    return db
        .queryForList(
            "SELECT id FROM evaluation_run WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
            String.class,
            user)
        .stream()
        .map(
            id -> {
              var v = view(user, id);
              v.remove("results");
              v.remove("config");
              v.remove("attempts");
              return (Object) v;
            })
        .toList();
  }

  public Object get(String user, String id) {
    return scoring.overlay(user, id, view(user, id));
  }

  private Map<String, Object> view(String user, String id) {
    var rows =
        db.queryForList(
            "SELECT payload,status,task_id,migration_error FROM evaluation_run WHERE id=? AND"
                + " user_id=?",
            id,
            user);
    if (rows.isEmpty()) throw AccessService.missing();
    var domain = rows.getFirst();
    var view = cast(questions.decode(domain.get("payload").toString()));
    if (!view.containsKey("metricDefinitionVersion")) {
      view.put("metricDefinitionVersion", "legacy-unversioned");
      view.put("metricDefinitionNote", "历史指标保留原值；正确拒答必须排除error且citationValid，未重写历史原始结果。");
    }
    if (domain.get("task_id") == null) {
      if (domain.get("migration_error") != null) {
        view.put("historicalPayloadStatus", view.get("status"));
        view.put("status", domain.get("status"));
        view.put("error", domain.get("migration_error"));
        view.put("migrationNote", "升级前旧进程已停止；原始payload与部分结果保留，未知在途调用不自动重放。重新评测请创建新任务。");
        view.put("partial", true);
      }
      return view;
    }
    var task = tasks.get(user, id);
    String status = Objects.toString(task.get("status"));
    view.put("status", status);
    view.put("taskStatus", status);
    view.put("taskId", id);
    view.put("progress", progress(id));
    var items =
        db.queryForList(
            "SELECT case_id,mode,status,attempts,result,error_code FROM evaluation_item WHERE"
                + " evaluation_id=? ORDER BY ordinal",
            id);
    var results = new ArrayList<Map<String, Object>>();
    var pending = new ArrayList<Object>();
    for (var item : items) {
      if (item.get("result") != null)
        results.add(cast(questions.decode(item.get("result").toString())));
      else
        pending.add(
            Map.of(
                "caseId",
                item.get("case_id"),
                "mode",
                item.get("mode"),
                "status",
                item.get("status")));
    }
    view.put("results", results);
    view.put("pendingItems", pending);
    view.put("partial", !pending.isEmpty());
    view.put("canScore", Set.of("SUCCEEDED", "FAILED", "CANCELLED").contains(status));
    view.put("error", task.get("errorCode"));
    view.put(
        "attempts",
        db.query(
            "SELECT row_to_json(a)::text FROM (SELECT"
                + " id,case_id,mode,attempt_number,fencing_token,status,error_code,result,started_at,finished_at"
                + " FROM evaluation_attempt WHERE evaluation_id=? ORDER BY started_at,id) a",
            (rs, n) -> questions.decode(rs.getString(1)),
            id));
    view.put(
        "externalCalls",
        db.query(
            "SELECT row_to_json(c)::text FROM (SELECT"
                + " call_id,operation_key,fencing_token,provider,status,usage,outcome,started_at,finished_at"
                + " FROM work_call WHERE task_id=? ORDER BY started_at,call_id) c",
            (rs, n) -> questions.decode(rs.getString(1)),
            id));
    view.put(
        "externalCallNote",
        "operation_key以evaluation_attempt.id为前缀；UNKNOWN表示调用可能已执行但未保存，不保证供应商exactly-once，未知用量为null。");
    var summary = new LinkedHashMap<String, Object>();
    for (String mode : List.of("vector", "hybrid")) {
      var subset = results.stream().filter(r -> mode.equals(r.get("mode"))).toList();
      var values = new LinkedHashMap<String, Object>();
      values.put("count", subset.size());
      values.put(
          "answerableCount",
          subset.stream().filter(r -> Boolean.TRUE.equals(r.get("answerable"))).count());
      values.put("plannedCount", items.stream().filter(r -> mode.equals(r.get("mode"))).count());
      values.put("errorCount", subset.stream().filter(r -> r.get("error") != null).count());
      for (String key : List.of("recallAtK", "mrr", "retrievalMs", "totalMs")) {
        var average =
            subset.stream()
                .map(r -> r.get(key))
                .filter(Objects::nonNull)
                .mapToDouble(v -> ((Number) v).doubleValue())
                .average();
        values.put(key, average.isPresent() ? average.getAsDouble() : null);
      }
      summary.put(mode, values);
    }
    view.put("summary", summary);
    var breakdowns = new LinkedHashMap<String, Object>();
    for (String dimension : List.of("category", "split", "group", "topic")) {
      var groups = new LinkedHashMap<String, Object>();
      results.stream()
          .map(r -> r.get(dimension))
          .filter(Objects::nonNull)
          .distinct()
          .forEach(
              value -> {
                var modes = new LinkedHashMap<String, Object>();
                for (String mode : List.of("vector", "hybrid")) {
                  var subset =
                      results.stream()
                          .filter(r -> mode.equals(r.get("mode")) && value.equals(r.get(dimension)))
                          .toList();
                  var stats = new LinkedHashMap<String, Object>();
                  stats.put("count", subset.size());
                  stats.put(
                      "errorCount", subset.stream().filter(r -> r.get("error") != null).count());
                  for (String key : List.of("recallAtK", "mrr", "retrievalMs", "totalMs")) {
                    var avg =
                        subset.stream()
                            .map(r -> r.get(key))
                            .filter(Objects::nonNull)
                            .mapToDouble(v -> ((Number) v).doubleValue())
                            .average();
                    stats.put(key, avg.isPresent() ? avg.getAsDouble() : null);
                  }
                  modes.put(mode, stats);
                }
                groups.put(value.toString(), modes);
              });
      breakdowns.put(dimension, groups);
    }
    view.put("breakdowns", breakdowns);
    return view;
  }
}
