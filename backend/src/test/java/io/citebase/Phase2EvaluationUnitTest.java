package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;

class Phase2EvaluationUnitTest {
  Evidence evidence(String id, String text, int start) {
    return new Evidence(id, "doc", "guide.md", "v1", 1, 1, start, start + text.length(), text, 1);
  }

  @Test
  void alternativesAreOneGroupButDistinctGroupsAreRequired() {
    var labels =
        List.of(
            new EvaluationMetrics.Label("guide.md", 1, 1, "alpha", null, null, null, "a"),
            new EvaluationMetrics.Label("guide.md", 1, 1, "beta", null, null, null, "a"),
            new EvaluationMetrics.Label("guide.md", 1, 1, "gamma", null, null, null, "b"));
    var one = EvaluationMetrics.compute(labels, List.of(evidence("one", "alpha beta", 0)));
    assertEquals(.5, one.recallAtK());
    assertEquals(1., one.mrr());
    assertTrue(one.evidenceHit());
    var all =
        EvaluationMetrics.compute(
            labels,
            List.of(
                evidence("none", "noise", 0),
                evidence("one", "beta", 0),
                evidence("two", "gamma", 0)));
    assertEquals(1., all.recallAtK());
    assertEquals(.5, all.mrr());
  }

  @Test
  void stableOffsetsAndSnapshotHashAreRequired() {
    var label = new EvaluationMetrics.Label("guide.md", 1, 1, "alpha", "hash", 3, 8, "a");
    var e = evidence("x", "---alpha---alpha", 0);
    assertTrue(EvaluationMetrics.matches(label, e, Map.of("v1", "hash")));
    assertFalse(EvaluationMetrics.matches(label, e, Map.of("v1", "stale")));
    assertFalse(
        EvaluationMetrics.matches(
            new EvaluationMetrics.Label("guide.md", 1, 1, "alpha", "hash", 2, 7, "a"),
            e,
            Map.of("v1", "hash")));
  }

  @Test
  void reconstructsOriginalParagraphAcrossChunks() throws Exception {
    String text = "甲".repeat(800) + "跨块证据" + "乙".repeat(900);
    var parts =
        new DocumentParser().parse(text.getBytes(java.nio.charset.StandardCharsets.UTF_8), "txt");
    var paragraphs = EvaluationLabels.reconstruct(parts);
    assertEquals(1, paragraphs.size());
    assertEquals(text, paragraphs.getFirst().text());
  }

  @Test
  void strictJsonRejectsUnknownCoercionDuplicatesAndSpoofedAudit() {
    var input = new EvaluationInput(new ObjectMapper());
    String valid =
        """
{"kbId":"k","name":"n","dataset":{"version":"v","questions":[{"id":"1","question":"q","answerable":false,"evidence":[]}]},"topK":5}
""";
    assertNotNull(input.request(valid));
    for (String bad :
        List.of(
            valid.replace("\"topK\":5", "\"topK\":\"5\""),
            valid.replace("\"name\":\"n\"", "\"name\":\"n\",\"owner\":\"bob\""),
            valid.replace("\"answerable\":false", "\"answerable\":\"false\""),
            valid.replace("\"version\":\"v\"", "\"version\":\"v\",\"version\":\"other\""),
            valid.replace("\"evidence\":[]", "\"evidence\":[],\"foo\":1")))
      assertThrows(IllegalArgumentException.class, () -> input.request(bad));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            input.score(
                "{\"caseId\":\"1\",\"mode\":\"vector\",\"answerCorrect\":true,\"source\":\"human\",\"rationale\":\"r\",\"ruleVersion\":\"v1\",\"errorCategories\":[],\"scoredBy\":\"bob\"}"));
  }
}
