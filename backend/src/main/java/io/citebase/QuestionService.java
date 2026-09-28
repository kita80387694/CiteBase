package io.citebase;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class QuestionService {
  private final RetrievalService retrieval;
  private final ModelGateway model;
  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final AccessService access;

  public QuestionService(
      RetrievalService retrieval,
      ModelGateway model,
      JdbcTemplate db,
      ObjectMapper json,
      AccessService access) {
    this.retrieval = retrieval;
    this.model = model;
    this.db = db;
    this.json = json;
    this.access = access;
  }

  @org.springframework.transaction.annotation.Transactional
  public QuestionResult ask(
      String user, String kb, String question, String mode, int k, boolean save) {
    return ask(user, kb, question, mode, k, save, null);
  }

  @org.springframework.transaction.annotation.Transactional
  public QuestionResult ask(
      String user,
      String kb,
      String question,
      String mode,
      int k,
      boolean save,
      RetrievalOptions supplied) {
    db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
    access.requireKnowledgeBase(user, kb);
    if (question == null || question.isBlank() || question.length() > 4000)
      throw new IllegalArgumentException("问题长度必须为 1–4000");
    long start = System.nanoTime();
    var retrieved = retrieval.retrieveDetailed(user, kb, question, mode, k, supplied);
    List<Evidence> evidence = retrieved.evidence();
    String retrievalError = retrieved.error();
    var context = CitationAliases.prepare(evidence, retrieved.options().citationStyle());
    long generationStart = System.nanoTime();
    Generation generation =
        retrievalError == null
            ? model.generate(question, context.promptEvidence())
            : new Generation(Citations.ABSTENTION, null, null, retrievalError);
    long generationMs = (System.nanoTime() - generationStart) / 1_000_000,
        citationStart = System.nanoTime();
    String mapped = generation.answer(), aliasError = null;
    try {
      mapped = CitationAliases.restore(mapped, context.aliases());
    } catch (IllegalArgumentException e) {
      mapped = Citations.ABSTENTION;
      aliasError = e.getMessage();
    }
    var checked =
        aliasError == null
            ? Citations.validate(mapped, evidence)
            : new Citations.Check(false, true, List.of(), Citations.ABSTENTION, aliasError);
    String error = generation.error() != null ? generation.error() : checked.error();
    var diagnostics = retrieved.diagnostics();
    @SuppressWarnings("unchecked")
    var timings = (Map<String, Object>) diagnostics.get("timings");
    timings.put("generationMs", generationMs);
    timings.put("citationMs", (System.nanoTime() - citationStart) / 1_000_000);
    diagnostics.put(
        "rawAnswer",
        retrievalError == null && generation.error() == null ? generation.answer() : null);
    diagnostics.put("aliasMap", context.aliases());
    diagnostics.put("dataVersions", retrieval.dataVersions(user, kb));
    QuestionResult result =
        new QuestionResult(
            UUID.randomUUID().toString(),
            question,
            checked.answer(),
            mode,
            model.mode(),
            evidence,
            checked.citations(),
            checked.valid(),
            checked.abstained(),
            retrieved.retrievalMs(),
            (System.nanoTime() - start) / 1_000_000,
            generation.promptTokens(),
            generation.completionTokens(),
            error,
            retrieved.options(),
            diagnostics,
            retrieved.usage());
    if (save)
      db.update(
          "INSERT INTO question_history(id,user_id,kb_id,result,config)"
              + " VALUES(?,?,?,?::jsonb,?::jsonb)",
          result.id(),
          user,
          kb,
          encode(result),
          encode(config(k, retrieved.options())));
    return result;
  }

  public Map<String, Object> config(int k) {
    return config(k, null);
  }

  public Map<String, Object> config(int k, RetrievalOptions supplied) {
    var options = RetrievalOptions.resolve(supplied, k);
    var config = new LinkedHashMap<String, Object>();
    config.put("modelMode", model.mode());
    config.put("chatModel", model.chatModel());
    config.put("embeddingModel", model.embeddingModel());
    config.put("topK", k);
    config.put("fusion", "keyword-vector RRF");
    config.put("rrfConstant", 60);
    config.put("candidateK", options.candidateK());
    config.put("retrievalOptions", options);
    config.put("reranker", retrieval.rerankerConfiguration());
    config.put("keywordAnalyzer", "Latin words + Han bigrams v1");
    config.put("temperature", 0);
    config.put("provider", model.configuration());
    config.put(
        "chunking",
        Map.of(
            "strategy",
            "per-active-document-version",
            "offsetUnit",
            "UTF-16",
            "details",
            "dataVersions contains actual chunk_strategy/chunk_size/chunk_overlap"));
    config.put("minimumSimilarity", null);
    config.put(
        "abstentionPolicy", "empty evidence or model-declared insufficiency or invalid citation");
    return config;
  }

  @org.springframework.transaction.annotation.Transactional
  public Map<String, Object> diagnose(
      String user, String kb, String question, String mode, int k, RetrievalOptions options) {
    db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
    access.requireKnowledgeBase(user, kb);
    var outcome = retrieval.retrieveDetailed(user, kb, question, mode, k, options);
    var result = new LinkedHashMap<String, Object>();
    result.put("kind", "retrieval-only");
    result.put("id", UUID.randomUUID().toString());
    result.put("question", question);
    result.put("mode", mode);
    result.put("modelMode", model.mode());
    result.put("evidence", outcome.evidence());
    result.put("error", outcome.error());
    result.put("retrievalMs", outcome.retrievalMs());
    result.put("retrievalOptions", outcome.options());
    result.put("diagnostics", outcome.diagnostics());
    result.put("usage", outcome.usage());
    result.put("config", config(k, outcome.options()));
    result.put("dataVersions", retrieval.dataVersions(user, kb));
    return result;
  }

  public List<Object> history(String user, String kb) {
    access.requireKnowledgeBase(user, kb);
    return db.query(
        "SELECT result FROM question_history WHERE user_id=? AND kb_id=? ORDER BY created_at DESC"
            + " LIMIT 100",
        (r, n) -> decode(r.getString(1)),
        user,
        kb);
  }

  public String encode(Object o) {
    try {
      return json.writeValueAsString(o);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public Object decode(String s) {
    try {
      return json.readValue(s, Object.class);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
