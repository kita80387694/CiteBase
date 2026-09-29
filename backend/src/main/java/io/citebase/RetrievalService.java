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

  public RetrievalService(
      JdbcTemplate db, ModelGateway model, AccessService access, RerankGateway reranker) {
    this.db = db;
    this.model = model;
    this.access = access;
    this.reranker = reranker;
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
      var embedded = model.embedWithUsage(question);
      complete(task, activeCall, embedded.usage());
      activeCall = null;
      AgentPolicy.externalUsage("embedding", embedded.usage());
      usage.put("embedding", embedded.usage());
      String vector = Arrays.toString(embedded.vector());
      timings.put(current, elapsed(stage));
      int candidates =
          mode.equals("hybrid")
                  || options.rerank()
                  || supplied != null && supplied.candidateK() != null
              ? options.candidateK()
              : topK;
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
      if (options.rerank() && !fused.isEmpty()) {
        current = "rerankMs";
        stage = System.nanoTime();
        counts.put("rerankInput", fused.size());
        if (model.mode().equals("real")
            && Boolean.TRUE.equals(reranker.configuration().get("configured")))
          AgentPolicy.beforeExternal();
        if (evaluationId != null) requireEvaluation(user, kb, evaluationId);
        activeCall =
            Boolean.TRUE.equals(reranker.configuration().get("configured"))
                ? begin(task, "rerank", question)
                : null;
        var reranked = reranker.rerank(question, fused, topK);
        complete(task, activeCall, reranked.usage());
        activeCall = null;
        AgentPolicy.externalUsage("rerank", reranked.usage());
        usage.put("rerank", reranked.usage());
        var ranked = new ArrayList<Evidence>();
        var ranks = new ArrayList<Map<String, Object>>();
        for (var row : reranked.results()) {
          var e = fused.get(row.index());
          ranked.add(withScore(e, row.score()));
          ranks.add(Map.of("index", row.index(), "score", row.score(), "chunkId", e.id()));
        }
        trace.put("rerank", ranks);
        selected = ranked;
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
