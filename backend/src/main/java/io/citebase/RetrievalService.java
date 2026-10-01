package io.citebase;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class RetrievalService {
  private final JdbcTemplate db;
  private final ModelGateway model;
  private final AccessService access;
  private final RerankGateway reranker;
  private final RetrievalCache cache;
  private final org.springframework.transaction.support.TransactionTemplate tx;
  private final com.fasterxml.jackson.databind.ObjectMapper json =
      new com.fasterxml.jackson.databind.ObjectMapper();

  public RetrievalService(
      JdbcTemplate db,
      ModelGateway model,
      AccessService access,
      RerankGateway reranker,
      RetrievalCache cache,
      org.springframework.transaction.PlatformTransactionManager tm) {
    this.db = db;
    this.model = model;
    this.access = access;
    this.reranker = reranker;
    this.cache = cache;
    this.tx = new org.springframework.transaction.support.TransactionTemplate(tm);
  }

  private static final String FROM =
      " FROM chunk c JOIN document d ON d.id=c.document_id AND d.active_version_id=c.version_id"
          + " JOIN knowledge_base k ON k.id=d.kb_id ";
  private static final String FIELDS =
      "c.id,c.document_id,d.name,c.version_id,c.page,c.paragraph,c.start_offset,c.end_offset,c.content";

  public List<Evidence> retrieve(String user, String kb, String question, String mode, int topK) {
    var result = retrieveDetailed(user, kb, question, mode, topK, null);
    if (result.error() != null) throw new SpringAiGateway.ModelFailure(result.error(), null);
    return result.evidence();
  }

  public RetrievalOutcome retrieveDetailed(
      String user, String kb, String question, String mode, int topK, RetrievalOptions supplied) {
    return retrieveDetailed(user, kb, question, mode, topK, supplied, null);
  }

  RetrievalOutcome retrieveDetailed(
      String user,
      String kb,
      String question,
      String mode,
      int topK,
      RetrievalOptions supplied,
      String evaluationId) {
    var options = RetrievalOptions.resolve(supplied, topK);
    if (!options.cacheEnabled())
      return compute(user, kb, question, mode, topK, supplied, evaluationId);
    if (question == null
        || question.isBlank()
        || question.length() > 4000
        || question.indexOf('\u0000') >= 0
        || !Set.of("vector", "hybrid").contains(mode)) throw new IllegalArgumentException("检索参数无效");
    long started = System.nanoTime();
    var scope =
        tx.execute(
            status -> {
              lock(kb);
              return scope(user, kb, evaluationId);
            });
    String key =
        cache.key(
            Map.of(
                "user",
                user,
                "kb",
                kb,
                "scope",
                evaluationId == null ? "ACTIVE" : evaluationId,
                "versions",
                scope,
                "query",
                question,
                "mode",
                mode,
                "topK",
                topK,
                "effectiveCandidates",
                candidateLimit(mode, topK, supplied, options),
                "options",
                options,
                "models",
                Map.of(
                    "embedding",
                    model.embeddingModel(),
                    "mode",
                    model.mode(),
                    "provider",
                    model.configuration(),
                    "reranker",
                    reranker.configuration())));
    var hit =
        tx.execute(
            status -> {
              lock(kb);
              if (!scope.equals(scope(user, kb, evaluationId))) throw changed();
              var value = cache.get(key);
              if (value != null) {
                try {
                  validateCached(user, kb, evaluationId, value);
                } catch (RuntimeException e) {
                  cache.remove(key);
                  throw e;
                }
              }
              return value;
            });
    if (hit != null) {
      var timings = (Map<String, Object>) hit.diagnostics().get("timings");
      timings.replaceAll((name, value) -> 0L);
      timings.put("cacheLookupMs", elapsed(started));
      var cost = (Map<String, Object>) hit.diagnostics().get("cost");
      cost.put("currentProviderCalls", Map.of("embedding", 0, "rerank", 0));
      cost.put("usageReason", "not_called_cache_hit");
      cost.put(
          "cache",
          Map.of(
              "status",
              "HIT",
              "scope",
              evaluationId == null ? "ACTIVE" : "EVALUATION_SNAPSHOT",
              "config",
              cache.configuration()));
      var usage = new LinkedHashMap<String, Object>();
      usage.put("embedding", null);
      usage.put("rerank", null);
      return new RetrievalOutcome(
          hit.evidence(), hit.options(), hit.diagnostics(), usage, null, elapsed(started));
    }
    var computed = compute(user, kb, question, mode, topK, supplied, evaluationId);
    if (computed.error() == null)
      tx.executeWithoutResult(
          status -> {
            lock(kb);
            if (!scope.equals(scope(user, kb, evaluationId))) throw changed();
            validateCached(user, kb, evaluationId, computed);
            cache.put(key, computed);
          });
    return computed;
  }

  private RetrievalOutcome compute(
      String user,
      String kb,
      String question,
      String mode,
      int topK,
      RetrievalOptions supplied,
      String evaluationId) {
    access.requireKnowledgeBase(user, kb);
    if (evaluationId != null) requireEvaluation(user, kb, evaluationId);
    String from =
        evaluationId == null ? FROM : FROM.replace(" AND d.active_version_id=c.version_id", "");
    String scope =
        evaluationId == null
            ? ""
            : " AND EXISTS(SELECT 1 FROM evaluation_snapshot es WHERE es.evaluation_id=? AND"
                + " es.version_id=c.version_id AND es.document_id=d.id)";
    if (!Set.of("vector", "hybrid").contains(mode) || topK < 1 || topK > 20)
      throw new IllegalArgumentException("检索模式或 topK 无效");
    if (question == null
        || question.isBlank()
        || question.length() > 4000
        || question.indexOf('\u0000') >= 0) throw new IllegalArgumentException("问题长度或内容无效");
    var options = RetrievalOptions.resolve(supplied, topK);
    var timings = new LinkedHashMap<String, Object>();
    for (String key : List.of("embeddingMs", "vectorMs", "keywordMs", "fusionMs", "rerankMs"))
      timings.put(key, 0L);
    var counts = new LinkedHashMap<String, Object>();
    for (String key : List.of("vector", "keyword", "fused", "rerankInput", "selected"))
      counts.put(key, 0);
    var trace = new LinkedHashMap<String, Object>();
    for (String key : List.of("vector", "keyword", "fused", "rerank")) trace.put(key, List.of());
    var diagnostics = new LinkedHashMap<String, Object>();
    diagnostics.put("timings", timings);
    diagnostics.put("candidateCounts", counts);
    diagnostics.put("trace", trace);
    var cost = new LinkedHashMap<String, Object>();
    var calls = new LinkedHashMap<String, Object>();
    calls.put("embedding", 0);
    calls.put("rerank", 0);
    cost.put("currentProviderCalls", calls);
    cost.put(
        "cache",
        Map.of(
            "status",
            options.cacheEnabled() ? "MISS" : "OFF",
            "scope",
            evaluationId == null ? "ACTIVE" : "EVALUATION_SNAPSHOT",
            "config",
            cache.configuration()));
    cost.put("rerankDecision", "DISABLED");
    diagnostics.put("cost", cost);
    var usage = new LinkedHashMap<String, Object>();
    usage.put("embedding", null);
    usage.put("rerank", null);
    long started = System.nanoTime(), stage = started;
    String current = "embeddingMs";
    TaskContext task = TaskContext.current();
    TaskCall activeCall = null;
    try {
      if (model.mode().equals("real")) AgentPolicy.beforeExternal();
      activeCall = begin(task, "embedding", question);
      if (model.mode().equals("real")
          || Boolean.TRUE.equals(model.configuration().get("externalNetwork")))
        calls.put("embedding", 1);
      var embedded = model.embedWithUsage(question);
      complete(task, activeCall, embedded.usage());
      activeCall = null;
      AgentPolicy.externalUsage("embedding", embedded.usage());
      usage.put("embedding", embedded.usage());
      String vector = Arrays.toString(embedded.vector());
      timings.put(current, elapsed(stage));
      int candidates = candidateLimit(mode, topK, supplied, options);
      current = "vectorMs";
      stage = System.nanoTime();
      List<Evidence> semantic =
          db.query(
              "SELECT "
                  + FIELDS
                  + ",1-(c.embedding <=> ?::vector) score"
                  + from
                  + " WHERE k.user_id=? AND k.id=? AND c.embedding_model=?"
                  + scope
                  + " ORDER BY c.embedding <=>"
                  + " ?::vector,c.id LIMIT ?",
              RetrievalService::row,
              scopedArgs(
                  evaluationId,
                  new Object[] {vector, user, kb, model.embeddingModel()},
                  new Object[] {vector, candidates}));
      timings.put(current, elapsed(stage));
      trace.put("vector", semantic);
      counts.put("vector", semantic.size());
      List<Evidence> lexical = List.of();
      String words = Lexical.tokens(question);
      if (mode.equals("hybrid") && !words.isBlank()) {
        current = "keywordMs";
        stage = System.nanoTime();
        String query = String.join(" | ", new LinkedHashSet<>(Arrays.asList(words.split(" "))));
        lexical =
            db.query(
                "SELECT "
                    + FIELDS
                    + ",ts_rank_cd(to_tsvector('simple',c.lexical),to_tsquery('simple',?)) score"
                    + from
                    + " WHERE k.user_id=? AND k.id=? AND c.embedding_model=?"
                    + scope
                    + " AND"
                    + " to_tsvector('simple',c.lexical) @@ to_tsquery('simple',?) ORDER BY score"
                    + " DESC,c.id LIMIT ?",
                RetrievalService::row,
                scopedArgs(
                    evaluationId,
                    new Object[] {query, user, kb, model.embeddingModel()},
                    new Object[] {query, candidates}));
        timings.put(current, elapsed(stage));
      }
      trace.put("keyword", lexical);
      counts.put("keyword", lexical.size());
      current = "fusionMs";
      stage = System.nanoTime();
      var fused =
          mode.equals("hybrid") && !words.isBlank()
              ? fuse(semantic, lexical, options.candidateK(), options.keywordWeight())
              : semantic;
      timings.put(current, elapsed(stage));
      trace.put("fused", fused);
      counts.put("fused", fused.size());
      List<Evidence> selected;
      var batch = RetrievalCandidates.group(fused, options.deduplicateEnabled());
      cost.put("rawCandidateCount", fused.size());
      cost.put("uniqueRerankInputs", batch.representatives().size());
      cost.put("dedupMapping", batch.mapping());
      cost.put(
          "savedInputCharacters",
          fused.stream().mapToInt(e -> e.text().length()).sum()
              - batch.representatives().stream().mapToInt(e -> e.text().length()).sum());
      boolean shouldRerank =
          options.rerank()
              && !fused.isEmpty()
              && (!options.conditionalRerank() || batch.representatives().size() > topK);
      cost.put(
          "rerankDecision",
          !options.rerank()
              ? "DISABLED"
              : fused.isEmpty()
                  ? "EMPTY"
                  : shouldRerank ? "APPLIED" : "SKIPPED_CANDIDATE_PRESSURE");
      if (shouldRerank) {
        current = "rerankMs";
        stage = System.nanoTime();
        counts.put("rerankInput", batch.representatives().size());
        if (model.mode().equals("real")
            && Boolean.TRUE.equals(reranker.configuration().get("configured")))
          AgentPolicy.beforeExternal();
        if (evaluationId != null) requireEvaluation(user, kb, evaluationId);
        activeCall =
            Boolean.TRUE.equals(reranker.configuration().get("configured"))
                ? begin(task, "rerank", question)
                : null;
        if (Boolean.TRUE.equals(reranker.configuration().get("configured"))) calls.put("rerank", 1);
        var reranked =
            reranker.rerank(
                question, batch.representatives(), Math.min(topK, batch.representatives().size()));
        complete(task, activeCall, reranked.usage());
        activeCall = null;
        AgentPolicy.externalUsage("rerank", reranked.usage());
        usage.put("rerank", reranked.usage());
        selected = batch.expand(reranked, topK);
        var ranks = new ArrayList<Map<String, Object>>();
        for (var row : reranked.results())
          ranks.add(
              Map.of(
                  "index",
                  row.index(),
                  "score",
                  row.score(),
                  "chunkIds",
                  batch.groups().get(row.index()).stream().map(Evidence::id).toList(),
                  "chunkId",
                  batch.representatives().get(row.index()).id()));
        trace.put("rerank", ranks);
        timings.put(current, elapsed(stage));
      } else selected = fused.stream().limit(topK).toList();
      counts.put("selected", selected.size());
      return new RetrievalOutcome(selected, options, diagnostics, usage, null, elapsed(started));
    } catch (SpringAiGateway.ModelFailure e) {
      if (activeCall != null)
        task.completeExternalCall(activeCall, Map.of("error", e.getMessage()), null);
      timings.put(current, elapsed(stage));
      return new RetrievalOutcome(
          List.of(), options, diagnostics, usage, e.getMessage(), elapsed(started));
    }
  }

  private int candidateLimit(
      String mode, int topK, RetrievalOptions supplied, RetrievalOptions options) {
    return mode.equals("hybrid")
            || options.rerank()
            || supplied != null && supplied.candidateK() != null
        ? options.candidateK()
        : topK;
  }

  private void lock(String kb) {
    db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
  }

  private List<Map<String, Object>> scope(String user, String kb, String evaluationId) {
    access.requireKnowledgeBase(user, kb);
    if (TaskContext.current() != null) TaskContext.current().checkActive();
    return evaluationId == null ? dataVersions(user, kb) : snapshot(user, kb, evaluationId);
  }

  private static org.springframework.web.server.ResponseStatusException changed() {
    return new org.springframework.web.server.ResponseStatusException(
        org.springframework.http.HttpStatus.CONFLICT, "SOURCE_CHANGED");
  }

  private void validateCached(
      String user, String kb, String evaluationId, RetrievalOutcome outcome) {
    access.requireKnowledgeBase(user, kb);
    if (evaluationId != null) requireEvaluation(user, kb, evaluationId);
    if (TaskContext.current() != null) TaskContext.current().checkActive();
    var all = new LinkedHashMap<String, Evidence>();
    for (var e : outcome.evidence()) all.put(e.id(), e);
    var trace = (Map<?, ?>) outcome.diagnostics().get("trace");
    for (String name : List.of("vector", "keyword", "fused"))
      for (Object value : (List<?>) trace.get(name)) {
        var e =
            value instanceof Evidence evidence
                ? evidence
                : json.convertValue(value, Evidence.class);
        all.put(e.id(), e);
      }
    for (var e : all.values()) {
      String condition =
          evaluationId == null
              ? " AND d.active_version_id=c.version_id"
              : " AND EXISTS(SELECT 1 FROM evaluation_snapshot es WHERE es.evaluation_id=? AND"
                  + " es.document_id=d.id AND es.version_id=c.version_id)";
      var args =
          new ArrayList<Object>(
              List.of(
                  user,
                  kb,
                  e.id(),
                  e.documentId(),
                  e.versionId(),
                  e.documentName(),
                  e.page(),
                  e.paragraph(),
                  e.startOffset(),
                  e.endOffset(),
                  e.text()));
      if (evaluationId != null) args.add(evaluationId);
      Integer count =
          db.queryForObject(
              "SELECT count(*) FROM chunk c JOIN document d ON d.id=c.document_id JOIN"
                  + " knowledge_base k ON k.id=d.kb_id WHERE k.user_id=? AND k.id=? AND c.id=? AND"
                  + " c.document_id=? AND c.version_id=? AND d.name=? AND c.page=? AND"
                  + " c.paragraph=? AND c.start_offset=? AND c.end_offset=? AND c.content=?"
                  + condition,
              Integer.class,
              args.toArray());
      if (count == null || count != 1) throw changed();
    }
  }

  private TaskCall begin(TaskContext context, String kind, String input) {
    if (context == null) return null;
    context.checkActive();
    if (!model.mode().equals("real")
        && !Boolean.TRUE.equals(model.configuration().get("externalNetwork"))) return null;
    return context.beginExternalCall(
        EvaluationCallScope.operation(kind),
        kind,
        AuthService.hash(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  private void complete(TaskContext context, TaskCall call, Object usage) {
    if (call != null) context.completeExternalCall(call, Map.of("received", true), usage);
    if (context != null) context.checkActive();
  }

  private Object[] scopedArgs(String evaluationId, Object[] before, Object[] after) {
    var args = new ArrayList<Object>(Arrays.asList(before));
    if (evaluationId != null) args.add(evaluationId);
    args.addAll(Arrays.asList(after));
    return args.toArray();
  }

  void requireEvaluation(String user, String kb, String id) {
    if (db.queryForObject(
            "SELECT count(*) FROM evaluation_run r JOIN knowledge_base k ON k.id=r.kb_id WHERE"
                + " r.id=? AND r.user_id=? AND k.user_id=? AND r.kb_id=?",
            Integer.class,
            id,
            user,
            user,
            kb)
        != 1) throw AccessService.missing();
  }

  List<Map<String, Object>> snapshot(String user, String kb, String id) {
    requireEvaluation(user, kb, id);
    return db.query(
        "SELECT metadata::text FROM evaluation_snapshot WHERE evaluation_id=? ORDER BY document_id",
        (rs, n) -> {
          try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(
                    rs.getString(1),
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        },
        id);
  }

  public Evidence evaluationCitation(String user, String id, String chunk) {
    var owned =
        db.queryForList(
            "SELECT kb_id,task_id FROM evaluation_run WHERE id=? AND user_id=?", id, user);
    if (owned.isEmpty()) throw AccessService.missing();
    if (owned.getFirst().get("task_id") == null) {
      if (db.queryForObject(
              "SELECT count(*) FROM evaluation_run r WHERE r.id=? AND r.user_id=? AND EXISTS(SELECT"
                  + " 1 FROM jsonb_array_elements(r.payload->'results') result,"
                  + " jsonb_array_elements(result->'evidence') e WHERE e->>'id'=?)",
              Integer.class,
              id,
              user,
              chunk)
          != 1) throw AccessService.missing();
      return citation(user, chunk);
    }
    var rows =
        db.query(
            "SELECT "
                + FIELDS
                + ",0 score"
                + FROM.replace(" AND d.active_version_id=c.version_id", "")
                + " JOIN evaluation_snapshot es ON es.document_id=d.id AND"
                + " es.version_id=c.version_id WHERE k.user_id=? AND es.evaluation_id=? AND c.id=?"
                + " AND EXISTS(SELECT 1 FROM evaluation_item i,"
                + " jsonb_array_elements(i.result->'evidence') e WHERE"
                + " i.evaluation_id=es.evaluation_id AND e->>'id'=c.id)",
            RetrievalService::row,
            user,
            id,
            chunk);
    if (rows.isEmpty()) throw AccessService.missing();
    return rows.getFirst();
  }

  private static long elapsed(long start) {
    return (System.nanoTime() - start) / 1_000_000;
  }

  public Map<String, Object> costConfiguration(RetrievalOptions options) {
    return Map.of(
        "version",
        "retrieval-cost-v1",
        "rerankPolicy",
        options.conditionalRerank() ? "candidate-pressure-v1" : "always",
        "deduplicate",
        options.deduplicateEnabled(),
        "dedupAlgorithm",
        "exact-provider-input-expand-v1",
        "cacheEnabled",
        options.cacheEnabled(),
        "cache",
        cache.configuration());
  }

  public Map<String, Object> rerankerConfiguration() {
    return reranker.configuration();
  }

  public List<Map<String, Object>> dataVersions(String user, String kb) {
    access.requireKnowledgeBase(user, kb);
    return db.queryForList(
        "SELECT d.id,d.name,v.id"
            + " version_id,v.content_hash,v.chunk_strategy,v.chunk_size,v.chunk_overlap FROM"
            + " document d JOIN document_version v ON v.id=d.active_version_id JOIN knowledge_base"
            + " k ON k.id=d.kb_id WHERE k.user_id=? AND k.id=? ORDER BY d.id",
        user,
        kb);
  }

  public static List<Evidence> fuse(List<Evidence> vector, List<Evidence> lexical, int k) {
    return fuse(vector, lexical, k, 1);
  }

  public static List<Evidence> fuse(
      List<Evidence> vector, List<Evidence> lexical, int k, double keywordWeight) {
    Map<String, Double> scores = new HashMap<>();
    Map<String, Evidence> all = new HashMap<>();
    var lists = List.of(vector, lexical);
    for (int source = 0; source < lists.size(); source++) {
      double weight = source == 0 ? 1 : keywordWeight;
      if (weight == 0) continue;
      var list = lists.get(source);
      for (int i = 0; i < list.size(); i++) {
        var e = list.get(i);
        all.put(e.id(), e);
        scores.merge(e.id(), weight / (60 + i + 1), Double::sum);
      }
    }
    return all.values().stream()
        .sorted(
            Comparator.<Evidence>comparingDouble(e -> scores.get(e.id()))
                .reversed()
                .thenComparing(Evidence::id))
        .limit(k)
        .map(
            e ->
                new Evidence(
                    e.id(),
                    e.documentId(),
                    e.documentName(),
                    e.versionId(),
                    e.page(),
                    e.paragraph(),
                    e.startOffset(),
                    e.endOffset(),
                    e.text(),
                    scores.get(e.id())))
        .toList();
  }

  private static Evidence withScore(Evidence e, double score) {
    return new Evidence(
        e.id(),
        e.documentId(),
        e.documentName(),
        e.versionId(),
        e.page(),
        e.paragraph(),
        e.startOffset(),
        e.endOffset(),
        e.text(),
        score);
  }

  public Evidence citation(String user, String id) {
    var rows =
        db.query(
            "SELECT " + FIELDS + ",0 score" + FROM + " WHERE k.user_id=? AND c.id=?",
            RetrievalService::row,
            user,
            id);
    if (rows.isEmpty())
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.NOT_FOUND, "引用不存在或无权限");
    return rows.getFirst();
  }

  private static Evidence row(java.sql.ResultSet r, int i) throws java.sql.SQLException {
    return new Evidence(
        r.getString(1),
        r.getString(2),
        r.getString(3),
        r.getString(4),
        r.getInt(5),
        r.getInt(6),
        r.getInt(7),
        r.getInt(8),
        r.getString(9),
        r.getDouble(10));
  }
}
