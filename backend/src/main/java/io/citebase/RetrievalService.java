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
    access.requireKnowledgeBase(user, kb);
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
    try {
      var embedded = model.embedWithUsage(question);
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
                  + FROM
                  + " WHERE k.user_id=? AND k.id=? AND c.embedding_model=? ORDER BY c.embedding <=>"
                  + " ?::vector,c.id LIMIT ?",
              RetrievalService::row,
              vector,
              user,
              kb,
              model.embeddingModel(),
              vector,
              candidates);
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
                    + FROM
                    + " WHERE k.user_id=? AND k.id=? AND c.embedding_model=? AND"
                    + " to_tsvector('simple',c.lexical) @@ to_tsquery('simple',?) ORDER BY score"
                    + " DESC,c.id LIMIT ?",
                RetrievalService::row,
                query,
                user,
                kb,
                model.embeddingModel(),
                query,
                candidates);
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
        var reranked = reranker.rerank(question, fused, topK);
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
      timings.put(current, elapsed(stage));
      return new RetrievalOutcome(
          List.of(), options, diagnostics, usage, e.getMessage(), elapsed(started));
    }
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
