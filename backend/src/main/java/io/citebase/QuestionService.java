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
    db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
    access.requireKnowledgeBase(user, kb);
    if (question == null || question.isBlank() || question.length() > 4000)
      throw new IllegalArgumentException("问题长度必须为 1–4000");
    long start = System.nanoTime();
    List<Evidence> evidence;
    String retrievalError = null;
    try {
      evidence = retrieval.retrieve(user, kb, question, mode, k);
    } catch (SpringAiGateway.ModelFailure e) {
      evidence = List.of();
      retrievalError = e.getMessage();
    }
    long retrievalMs = (System.nanoTime() - start) / 1_000_000;
    Generation generation =
        retrievalError == null
            ? model.generate(question, evidence)
            : new Generation(Citations.ABSTENTION, null, null, retrievalError);
    var checked = Citations.validate(generation.answer(), evidence);
    String error = generation.error() != null ? generation.error() : checked.error();
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
            retrievalMs,
            (System.nanoTime() - start) / 1_000_000,
            generation.promptTokens(),
            generation.completionTokens(),
            error);
    if (save)
      db.update(
          "INSERT INTO question_history(id,user_id,kb_id,result,config)"
              + " VALUES(?,?,?,?::jsonb,?::jsonb)",
          result.id(),
          user,
          kb,
          encode(result),
          encode(config(k)));
    return result;
  }

  public Map<String, Object> config(int k) {
    var config = new LinkedHashMap<String, Object>();
    config.put("modelMode", model.mode());
    config.put("chatModel", model.chatModel());
    config.put("embeddingModel", model.embeddingModel());
    config.put("topK", k);
    config.put("fusion", "keyword-vector RRF");
    config.put("rrfConstant", 60);
    config.put("candidateK", Math.max(20, k * 4));
    config.put("keywordAnalyzer", "Latin words + Han bigrams v1");
    config.put("temperature", 0);
    config.put("provider", model.configuration());
    config.put(
        "chunking",
        Map.of(
            "strategy",
            "page-paragraph-window-v1",
            "maxChars",
            900,
            "strideChars",
            700,
            "offsetUnit",
            "UTF-16"));
    config.put("minimumSimilarity", null);
    config.put(
        "abstentionPolicy", "empty evidence or model-declared insufficiency or invalid citation");
    return config;
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
