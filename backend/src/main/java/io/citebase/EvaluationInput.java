package io.citebase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.stereotype.Component;

/** Explicit wire schema: Jackson's default coercions/unknown-field tolerance do not apply. */
@Component
public class EvaluationInput {
  private final ObjectMapper mapper;

  public EvaluationInput(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  private JsonNode parse(String source) {
    try {
      return mapper
          .copy()
          .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
          .enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .readTree(source);
    } catch (java.io.IOException e) {
      throw new IllegalArgumentException("JSON语法或重复字段无效");
    }
  }

  public EvaluationService.Request request(String source) {
    return request(parse(source));
  }

  public EvaluationScoringService.Request score(String source) {
    return score(parse(source));
  }

  public EvaluationService.Request request(JsonNode root) {
    object(root, Set.of("kbId", "name", "dataset", "topK", "retrievalOptions", "idempotencyKey"));
    text(root, "idempotencyKey", true);
    text(root, "kbId", true);
    text(root, "name", true);
    integer(root, "topK", false);
    retrievalOptions(
        root.get("retrievalOptions"),
        root.path("topK").isIntegralNumber() ? root.get("topK").intValue() : 5);
    var dataset = root.get("dataset");
    object(dataset, Set.of("version", "questions", "seed", "split"));
    text(dataset, "version", true);
    text(dataset, "split", false);
    integer(dataset, "seed", false);
    var cases = dataset.get("questions");
    if (cases == null || !cases.isArray() || cases.isEmpty() || cases.size() > 200) bad();
    for (var c : cases) {
      object(
          c,
          Set.of(
              "id",
              "question",
              "answerable",
              "expectedAnswer",
              "evidence",
              "category",
              "split",
              "group",
              "topic"));
      for (String field : List.of("id", "question")) text(c, field, true);
      for (String field : List.of("expectedAnswer", "category", "split", "group", "topic"))
        text(c, field, false);
      if (c.get("answerable") == null || !c.get("answerable").isBoolean()) bad();
      var labels = c.get("evidence");
      if (labels == null || !labels.isArray() || labels.size() > 100) bad();
      for (var label : labels) {
        object(
            label,
            Set.of(
                "documentName",
                "page",
                "paragraph",
                "quote",
                "sourceHash",
                "startOffset",
                "endOffset",
                "groupId"));
        text(label, "documentName", true);
        text(label, "quote", true);
        text(label, "sourceHash", false);
        text(label, "groupId", false);
        for (String field : List.of("page", "paragraph", "startOffset", "endOffset"))
          integer(label, field, false);
      }
    }
    return mapper.convertValue(root, EvaluationService.Request.class);
  }

  public EvaluationScoringService.Request score(JsonNode root) {
    object(
        root,
        Set.of(
            "caseId",
            "mode",
            "answerCorrect",
            "source",
            "rationale",
            "ruleVersion",
            "citationSupported",
            "errorCategories"));
    for (String field : List.of("caseId", "mode", "source", "rationale", "ruleVersion"))
      text(root, field, true);
    if (root.get("answerCorrect") == null || !root.get("answerCorrect").isBoolean()) bad();
    var support = root.get("citationSupported");
    if (support != null && !support.isNull() && !support.isBoolean()) bad();
    var errors = root.get("errorCategories");
    if (errors == null || !errors.isArray() || errors.size() > 7) bad();
    for (var e : errors)
      if (!e.isTextual() || !EvaluationScoringService.CATEGORIES.contains(e.asText())) bad();
    return mapper.convertValue(root, EvaluationScoringService.Request.class);
  }

  public RagController.Ask ask(String source) {
    var root = parse(source);
    object(root, Set.of("kbId", "question", "mode", "topK", "retrievalOptions"));
    text(root, "kbId", true);
    text(root, "question", true);
    text(root, "mode", false);
    integer(root, "topK", false);
    int topK = root.path("topK").isIntegralNumber() ? root.get("topK").intValue() : 5;
    retrievalOptions(root.get("retrievalOptions"), topK);
    if (root.hasNonNull("mode") && !Set.of("vector", "hybrid").contains(root.get("mode").asText()))
      throw new IllegalArgumentException("mode必须vector或hybrid");
    return mapper.convertValue(root, RagController.Ask.class);
  }

  private void retrievalOptions(JsonNode node, int topK) {
    if (node == null || node.isNull()) {
      RetrievalOptions.resolve(null, topK);
      return;
    }
    object(
        node,
        Set.of(
            "candidateK",
            "keywordWeight",
            "rerank",
            "citationStyle",
            "rerankPolicy",
            "deduplicate",
            "cache"));
    integer(node, "candidateK", false);
    text(node, "citationStyle", false);
    text(node, "rerankPolicy", false);
    for (String flag : java.util.List.of("deduplicate", "cache")) {
      var v = node.get(flag);
      if (v != null && !v.isBoolean()) throw new IllegalArgumentException(flag + "必须boolean");
    }
    var weight = node.get("keywordWeight");
    if (weight != null
        && !weight.isNull()
        && (!weight.isNumber() || !Double.isFinite(weight.doubleValue())))
      throw new IllegalArgumentException("keywordWeight必须有限数值");
    var rerank = node.get("rerank");
    if (rerank != null && !rerank.isNull() && !rerank.isBoolean())
      throw new IllegalArgumentException("rerank必须boolean");
    RetrievalOptions.resolve(mapper.convertValue(node, RetrievalOptions.class), topK);
  }

  private static void object(JsonNode node, Set<String> fields) {
    if (node == null || !node.isObject()) bad();
    node.fieldNames()
        .forEachRemaining(
            f -> {
              if (!fields.contains(f))
                throw new IllegalArgumentException(
                    "未知字段：" + f.substring(0, Math.min(f.length(), 100)));
            });
  }

  private static void text(JsonNode node, String field, boolean required) {
    var value = node.get(field);
    if (value == null || value.isNull()) {
      if (required) throw new IllegalArgumentException("缺少字段：" + field);
      return;
    }
    if (value.isTextual() && value.asText().indexOf('\u0000') >= 0)
      throw new IllegalArgumentException("字段不得包含NUL字符：" + field);
    if (!value.isTextual() || value.asText().isBlank() || value.asText().length() > 16000)
      throw new IllegalArgumentException("字段必须为非空字符串且不超过16000字符：" + field);
  }

  private static void integer(JsonNode node, String field, boolean required) {
    var value = node.get(field);
    if (value == null || value.isNull()) {
      if (required) throw new IllegalArgumentException("缺少字段：" + field);
      return;
    }
    if (!value.isIntegralNumber() || !value.canConvertToInt())
      throw new IllegalArgumentException("字段必须为整数：" + field);
  }

  private static void bad() {
    throw new IllegalArgumentException("评测JSON字段或类型无效");
  }
}
