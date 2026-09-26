package io.citebase;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class RetrievalService {
  private final JdbcTemplate db;
  private final ModelGateway model;
  private final AccessService access;

  public RetrievalService(JdbcTemplate db, ModelGateway model, AccessService access) {
    this.db = db;
    this.model = model;
    this.access = access;
  }

  private static final String FROM =
      " FROM chunk c JOIN document d ON d.id=c.document_id AND d.active_version_id=c.version_id"
          + " JOIN knowledge_base k ON k.id=d.kb_id ";
  private static final String FIELDS =
      "c.id,c.document_id,d.name,c.version_id,c.page,c.paragraph,c.start_offset,c.end_offset,c.content";

  public List<Evidence> retrieve(String user, String kb, String question, String mode, int topK) {
    access.requireKnowledgeBase(user, kb);
    if (!Set.of("vector", "hybrid").contains(mode) || topK < 1 || topK > 20)
      throw new IllegalArgumentException("检索模式或 topK 无效");
    String vector = Arrays.toString(model.embed(question));
    int candidates = mode.equals("hybrid") ? Math.max(20, topK * 4) : topK;
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
    if (mode.equals("vector")) return semantic;
    String words = Lexical.tokens(question);
    if (words.isBlank()) return semantic.stream().limit(topK).toList();
    String query = String.join(" | ", new LinkedHashSet<>(Arrays.asList(words.split(" "))));
    List<Evidence> lexical =
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
    return fuse(semantic, lexical, topK);
  }

  public static List<Evidence> fuse(List<Evidence> vector, List<Evidence> lexical, int k) {
    Map<String, Double> scores = new HashMap<>();
    Map<String, Evidence> all = new HashMap<>();
    for (var list : List.of(vector, lexical))
      for (int i = 0; i < list.size(); i++) {
        var e = list.get(i);
        all.put(e.id(), e);
        scores.merge(e.id(), 1.0 / (60 + i + 1), Double::sum);
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
