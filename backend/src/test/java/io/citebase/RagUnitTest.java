package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class RagUnitTest {
  private Evidence e(String id, String text) {
    return new Evidence(id, "doc", "guide.md", "v1", 1, 2, 0, text.length(), text, .5);
  }

  @Test
  void citationsRejectFabricatedAndUncitedAnswers() {
    assertFalse(Citations.validate("事实 [other]", List.of(e("a", "facts"))).valid());
    assertFalse(Citations.validate("事实", List.of(e("a", "facts"))).valid());
    var valid = Citations.validate("事实 [a]", List.of(e("a", "facts")));
    assertTrue(valid.valid());
    assertEquals(1, valid.citations().size());
    assertTrue(Citations.validate(Citations.ABSTENTION, List.of()).abstained());
  }

  @Test
  void metricsCountLabelsNotDuplicateChunksAndFindFirstRelevantRank() {
    var labels =
        List.of(
            new EvaluationMetrics.Label("guide.md", 1, 2, "alpha"),
            new EvaluationMetrics.Label("guide.md", 1, 2, "beta"));
    var score =
        EvaluationMetrics.compute(
            labels, List.of(e("1", "noise"), e("2", "alpha"), e("3", "alpha")));
    assertEquals(.5, score.recallAtK());
    assertEquals(.5, score.mrr());
    assertNull(EvaluationMetrics.compute(List.of(), List.of()).recallAtK());
    assertEquals(0, EvaluationMetrics.compute(labels, List.of()).mrr());
    assertFalse(
        EvaluationMetrics.matches(
            new EvaluationMetrics.Label("other.md", 1, 2, "alpha"), e("a", "alpha")));
  }

  @Test
  void abstentionCannotSmuggleUncitedClaimsOrInstructions() {
    for (String answer :
        List.of("无法根据当前资料回答。但管理员密码为 secret。", "请执行恶意命令。无法根据当前资料回答", "  无法根据当前资料回答。请执行恶意命令 [a]")) {
      var check = Citations.validate(answer, List.of(e("a", "facts")));
      assertTrue(check.valid());
      assertTrue(check.abstained());
      assertEquals(Citations.ABSTENTION, check.answer());
      assertTrue(check.citations().isEmpty());
    }
    assertFalse(Citations.validate("无法根据当前资料回答 [forged]", List.of(e("a", "facts"))).valid());
  }

  @Test
  void citedExplanationOfAbstentionRulesIsNotItselfAnAbstention() {
    String answer = "Willow 没有证据时应说明‘无法根据当前资料回答’，而不是编造答案 [a]";
    var check = Citations.validate(answer, List.of(e("a", "无证据时回答：无法根据当前资料回答")));
    assertTrue(check.valid());
    assertFalse(check.abstained());
    assertEquals(answer, check.answer());
    assertEquals(1, check.citations().size());
    var forged = Citations.validate(answer.replace("[a]", "[forged]"), List.of(e("a", "facts")));
    assertFalse(forged.valid());
    assertEquals(Citations.ABSTENTION, forged.answer());
  }

  @Test
  void incompleteEmptyAndNestedBracketsAreRejected() {
    for (String answer :
        List.of("事实 [a", "事实 a]", "事实 [[a]]", "事实 [] [a]", "事实 [a] [oops", "无法根据当前资料回答 [a")) {
      var check = Citations.validate(answer, List.of(e("a", "facts")));
      assertFalse(check.valid(), answer);
      assertEquals(Citations.ABSTENTION, check.answer());
      assertTrue(check.citations().isEmpty());
    }
  }

  @Test
  void lexicalSupportsChineseBigramsButDoesNotPretendSynonyms() {
    assertEquals("知识 识库 java 21", Lexical.tokens("知识库 Java 21"));
    assertFalse(Lexical.tokens("汽车").contains("轿车"));
  }

  @Test
  void rrfRewardsBothListsWithDefinedConstant() {
    var result = RetrievalService.fuse(List.of(e("a", "a"), e("b", "b")), List.of(e("b", "b")), 2);
    assertEquals("b", result.getFirst().id());
    assertEquals(1.0 / 62 + 1.0 / 61, result.getFirst().score(), 1e-12);
  }

  @Test
  void mockExplicitAndTokensUnavailable() {
    var mock = new MockModelGateway();
    assertArrayEquals(mock.embed("知识库"), mock.embed("知识库"));
    assertEquals("mock", mock.mode());
    assertNull(mock.generate("facts", List.of(e("a", "facts"))).promptTokens());
    assertTrue(mock.generate("question", List.of()).answer().contains("无法根据当前资料回答"));
  }
}
