package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@SuppressWarnings("unchecked")
class ReviewIntegrationTest extends Stage2RetrievalIntegrationTest {
  @Autowired ReviewService reviews;

  Map<String, Object> project() {
    var run =
        runEvaluation(
            alice,
            new EvaluationService.Request(
                kb,
                "review",
                new EvaluationService.Dataset(
                    "review-v1",
                    List.of(
                        new EvaluationService.Case(
                            "unknown", "unknown policy?", false, null, List.of()))),
                5));
    return (Map<String, Object>)
        reviews.create(
            alice,
            Map.of(
                "name",
                "blind",
                "ruleVersion",
                "human-v1",
                "sources",
                List.of(Map.of("kind", "EVALUATION", "runId", run.get("id")))));
  }

  String assign(Map<String, Object> p) {
    reviews.assign(
        alice,
        p.get("id").toString(),
        Map.of("usernames", List.of("alice", "bob"), "secondReviewPercent", 100, "seed", 5));
    return ((List<Map<String, Object>>)
            ((Map<String, Object>) reviews.project(alice, p.get("id").toString()))
                .get("assignments"))
        .stream()
            .filter(a -> "bob".equals(a.get("username")))
            .findFirst()
            .orElseThrow()
            .get("id")
            .toString();
  }

  @Test
  void reviewerGetsBlindPackageNotSourceAuthority() {
    var p = project();
    String a = assign(p);
    var view = (Map<String, Object>) reviews.assignment(bob, a);
    assertEquals("AVAILABLE", view.get("status"));
    assertFalse(view.containsKey("source"));
    assertFalse(view.containsKey("mode"));
    assertFalse(view.containsKey("modelMode"));
    assertFalse(view.containsKey("trace"));
    assertNull(view.get("latestScore"));
    assertThrows(RuntimeException.class, () -> reviews.project(bob, p.get("id").toString()));
    assertThrows(RuntimeException.class, () -> retrieval.retrieve(bob, kb, "alpha", "vector", 5));
  }

  @Test
  void scoreAuditCannotImpersonateAndRevokeIsImmediate() {
    var p = project();
    String a = assign(p);
    reviews.score(bob, a, ReviewUnitTest.valid());
    var revised = ReviewUnitTest.valid();
    revised.put("correctness", "INCORRECT");
    reviews.score(bob, a, revised);
    var v = (Map<String, Object>) reviews.assignment(bob, a);
    assertEquals(2, ((List<?>) v.get("history")).size());
    var forged = ReviewUnitTest.valid();
    forged.put("scoredBy", alice);
    assertThrows(RuntimeException.class, () -> reviews.score(bob, a, forged));
    reviews.revoke(alice, p.get("id").toString(), Map.of("username", "bob"));
    assertThrows(RuntimeException.class, () -> reviews.assignment(bob, a));
    assertThrows(RuntimeException.class, () -> reviews.score(bob, a, ReviewUnitTest.valid()));
  }

  @Test
  void deletedKnowledgeBaseWithdrawsAnswerAndScoreRationale() {
    var p = project();
    String a = assign(p);
    reviews.score(bob, a, ReviewUnitTest.valid());
    db.update("DELETE FROM knowledge_base WHERE id=?", kb);
    var view = (Map<String, Object>) reviews.assignment(bob, a);
    assertEquals("WITHDRAWN", view.get("status"));
    assertFalse(view.containsKey("answer"));
    assertFalse(view.containsKey("history"));
    assertThrows(RuntimeException.class, () -> reviews.score(bob, a, ReviewUnitTest.valid()));
    var exported = (Map<String, Object>) reviews.project(alice, p.get("id").toString());
    assertTrue(exported.get("scores").toString().contains("withdrawn"));
    assertFalse(exported.get("scores").toString().contains("人工依据"));
  }

  @Test
  void sourceMutationWithdrawsAndCrossOwnerImportFails() {
    var p = project();
    String a = assign(p);
    var item = ((List<Map<String, Object>>) p.get("items")).getFirst();
    var src = (Map<String, Object>) item.get("source");
    assertThrows(
        RuntimeException.class,
        () ->
            reviews.create(
                bob, Map.of("name", "steal", "ruleVersion", "v1", "sources", List.of(src))));
    db.update(
        "UPDATE evaluation_item SET result=jsonb_set(result,'{answer}','\"changed\"') WHERE"
            + " evaluation_id=?",
        src.get("runId"));
    assertEquals("WITHDRAWN", ((Map<?, ?>) reviews.assignment(bob, a)).get("status"));
  }

  @Test
  void independentScoresDisagreementAndAdjudicationRemainAuditable() {
    var p = project();
    assign(p);
    String pid = p.get("id").toString();
    var detail = (Map<String, Object>) reviews.project(alice, pid);
    var assignments = (List<Map<String, Object>>) detail.get("assignments");
    for (var a : assignments)
      reviews.score(
          a.get("username").equals("alice") ? alice : bob,
          a.get("id").toString(),
          ReviewUnitTest.valid());
    detail = (Map<String, Object>) reviews.project(alice, pid);
    var stats = (Map<String, Object>) detail.get("stats");
    assertEquals(1d, stats.get("agreement"));
    String item = ((List<Map<String, Object>>) detail.get("items")).getFirst().get("id").toString();
    var adjudicate = ReviewUnitTest.valid();
    adjudicate.put("itemId", item);
    reviews.adjudicate(alice, pid, adjudicate);
    assertTrue(
        ((Map<?, ?>) reviews.project(alice, pid))
            .get("scores")
            .toString()
            .contains("ADJUDICATION"));
  }

  @Test
  void importCannotScoreAnotherReviewerAndRollsBackEarlierRows() {
    var p = project();
    String a = assign(p);
    var detail = (Map<String, Object>) reviews.project(alice, p.get("id").toString());
    var all = (List<Map<String, Object>>) detail.get("assignments");
    String aliceAssignment =
        all.stream()
            .filter(x -> "alice".equals(x.get("username")))
            .findFirst()
            .orElseThrow()
            .get("id")
            .toString();
    var own = ReviewUnitTest.valid();
    own.put("assignmentId", a);
    var forged = ReviewUnitTest.valid();
    forged.put("assignmentId", aliceAssignment);
    assertThrows(
        RuntimeException.class,
        () -> reviews.importScores(bob, Map.of("scores", List.of(own, forged))));
    assertTrue(((List<?>) ((Map<?, ?>) reviews.assignment(bob, a)).get("history")).isEmpty());
  }

  @Test
  void activeVersionChangeWithdrawsAndPreventsNewScore() {
    var p = project();
    String a = assign(p);
    assertEquals("AVAILABLE", ((Map<?, ?>) reviews.assignment(bob, a)).get("status"));
    db.update("UPDATE document SET active_version_id=NULL WHERE kb_id=?", kb);
    var withdrawn = (Map<?, ?>) reviews.assignment(bob, a);
    assertEquals("WITHDRAWN", withdrawn.get("status"));
    assertFalse(withdrawn.containsKey("evidence"));
    assertThrows(RuntimeException.class, () -> reviews.score(bob, a, ReviewUnitTest.valid()));
  }

  @Test
  void assignmentStrictlyRejectsUnknownFractionalAndWrongTypedParameters() {
    var p = project();
    String pid = p.get("id").toString();
    for (Object value : List.of(20.5, "20", 101)) {
      var error =
          assertThrows(
              org.springframework.web.server.ResponseStatusException.class,
              () ->
                  reviews.assign(
                      alice,
                      pid,
                      Map.of("usernames", List.of("alice", "bob"), "secondReviewPercent", value)));
      assertEquals(400, error.getStatusCode().value());
    }
    var error =
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () ->
                reviews.assign(
                    alice, pid, Map.of("usernames", List.of("alice", "bob"), "userId", bob)));
    assertEquals(400, error.getStatusCode().value());
  }

  @Autowired AgentRunRepository agentRuns;
  @Autowired AgentInput agentInput;

  @Test
  void cancelledAgentWithoutAnswerRemainsReviewableAndMockIsDisclosedOnlyToOwner() {
    var run =
        agentRuns.create(
            alice,
            agentInput.parse(
                "{\"kbId\":\""
                    + kb
                    + "\",\"question\":\"unknown?\",\"idempotencyKey\":\""
                    + UUID.randomUUID()
                    + "\"}"));
    String runId = run.get("id").toString();
    agentRuns.cancel(alice, runId);
    var p =
        (Map<String, Object>)
            reviews.create(
                alice,
                Map.of(
                    "name",
                    "neutral",
                    "ruleVersion",
                    "human-v1",
                    "sources",
                    List.of(Map.of("kind", "AGENT", "runId", runId))));
    var items = (List<Map<String, Object>>) p.get("items");
    assertEquals("mock", items.getFirst().get("modelMode"));
    String a = assign(p);
    var view = (Map<?, ?>) reviews.assignment(bob, a);
    assertEquals(true, view.get("executionFailed"));
    assertFalse(view.containsKey("modelMode"));
    assertEquals("", view.get("answer"));
  }

  @Test
  void agentSourceCannotDuplicateIdentityUsingIgnoredEvaluationFields() {
    var invalid =
        Map.<String, Object>of(
            "kind", "AGENT", "runId", "irrelevant", "caseId", "fake", "mode", "vector");
    var error =
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () ->
                reviews.create(
                    alice,
                    Map.of("name", "neutral", "ruleVersion", "v1", "sources", List.of(invalid))));
    assertEquals(400, error.getStatusCode().value());
  }

  @Test
  void linkedReferenceDeletionWithdrawsAgentPacket() {
    var evaluation = project();
    var src =
        (Map<String, Object>)
            ((List<Map<String, Object>>) evaluation.get("items")).getFirst().get("source");
    var run =
        agentRuns.create(
            alice,
            agentInput.parse(
                "{\"kbId\":\""
                    + kb
                    + "\",\"question\":\"unknown policy?\",\"idempotencyKey\":\""
                    + UUID.randomUUID()
                    + "\"}"));
    String runId = run.get("id").toString();
    agentRuns.cancel(alice, runId);
    var p =
        (Map<String, Object>)
            reviews.create(
                alice,
                Map.of(
                    "name",
                    "neutral",
                    "ruleVersion",
                    "v1",
                    "sources",
                    List.of(Map.of("kind", "AGENT", "runId", runId))));
    String a = assign(p);
    assertEquals("AVAILABLE", ((Map<?, ?>) reviews.assignment(bob, a)).get("status"));
    db.update("DELETE FROM evaluation_run WHERE id=?", src.get("runId"));
    var withdrawn = (Map<?, ?>) reviews.assignment(bob, a);
    assertEquals("WITHDRAWN", withdrawn.get("status"));
    assertFalse(withdrawn.containsKey("referenceAnswer"));
  }

  @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;

  @Test
  void ownerExportWaitsForSourceDeletionAndRedactsRationale() throws Exception {
    var p = project();
    String a = assign(p);
    reviews.score(bob, a, ReviewUnitTest.valid());
    String pid = p.get("id").toString();
    var tx = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<Object>> pending =
          new java.util.concurrent.atomic.AtomicReference<>();
      tx.execute(
          status -> {
            db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", kb);
            pending.set(executor.submit(() -> reviews.project(alice, pid)));
            assertThrows(
                java.util.concurrent.TimeoutException.class,
                () -> pending.get().get(250, java.util.concurrent.TimeUnit.MILLISECONDS));
            db.update("DELETE FROM knowledge_base WHERE id=?", kb);
            return null;
          });
      var exported = (Map<?, ?>) pending.get().get(5, java.util.concurrent.TimeUnit.SECONDS);
      assertTrue(exported.get("scores").toString().contains("withdrawn"));
      assertFalse(exported.get("scores").toString().contains("人工依据"));
    }
  }

  @Test
  void scoreAndAdjudicationSerializeOnItemAndRecordExactScoreVersions() throws Exception {
    var p = project();
    String bobAssignment = assign(p), pid = p.get("id").toString();
    String item =
        db.queryForObject(
            "SELECT item_id FROM review_assignment WHERE id=?", String.class, bobAssignment);
    String aliceAssignment =
        db.queryForObject(
            "SELECT id FROM review_assignment WHERE item_id=? AND reviewer_id=?",
            String.class,
            item,
            alice);
    reviews.score(alice, aliceAssignment, ReviewUnitTest.valid());
    reviews.score(bob, bobAssignment, ReviewUnitTest.valid());
    var adjudication = ReviewUnitTest.valid();
    adjudication.put("itemId", item);
    var tx = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var started = new java.util.concurrent.CountDownLatch(2);
      var pending = new ArrayList<java.util.concurrent.Future<Object>>();
      tx.execute(
          status -> {
            db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
            db.queryForList("SELECT id FROM review_item WHERE id=? FOR UPDATE", item);
            pending.add(
                executor.submit(
                    () -> {
                      started.countDown();
                      var revision = ReviewUnitTest.valid();
                      revision.put("correctness", "PARTIAL");
                      return reviews.score(bob, bobAssignment, revision);
                    }));
            pending.add(
                executor.submit(
                    () -> {
                      started.countDown();
                      return reviews.adjudicate(alice, pid, adjudication);
                    }));
            try {
              assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS));
            } catch (InterruptedException e) {
              throw new AssertionError(e);
            }
            for (var call : pending)
              assertThrows(
                  java.util.concurrent.TimeoutException.class,
                  () -> call.get(250, java.util.concurrent.TimeUnit.MILLISECONDS));
            return null;
          });
      for (var call : pending) call.get(10, java.util.concurrent.TimeUnit.SECONDS);
    }
    var event =
        db.queryForMap(
            "SELECT sequence_id,payload::text FROM review_score WHERE item_id=? AND"
                + " kind='ADJUDICATION'",
            item);
    var payload = (Map<String, Object>) questions.decode(event.get("payload").toString());
    var expected =
        db.queryForList(
            "SELECT DISTINCT ON (assignment_id) id FROM review_score WHERE item_id=? AND"
                + " kind='HUMAN' AND sequence_id<? ORDER BY assignment_id,sequence_id DESC",
            String.class,
            item,
            event.get("sequence_id"));
    assertEquals(
        new HashSet<>(expected), new HashSet<>((List<String>) payload.get("reviewedScoreIds")));
    assertEquals(2, expected.size());
    assertEquals(
        3,
        db.queryForObject(
            "SELECT count(*) FROM review_score WHERE item_id=? AND kind='HUMAN'",
            Integer.class,
            item));
  }

  @Test
  void revokeUsesSameItemOrderAndCannotLeaveAdjudicationWithRevokedSecondReviewer()
      throws Exception {
    var p = project();
    String a = assign(p), pid = p.get("id").toString();
    String item =
        db.queryForObject("SELECT item_id FROM review_assignment WHERE id=?", String.class, a);
    String other =
        db.queryForObject(
            "SELECT id FROM review_assignment WHERE item_id=? AND reviewer_id=?",
            String.class,
            item,
            alice);
    reviews.score(alice, other, ReviewUnitTest.valid());
    reviews.score(bob, a, ReviewUnitTest.valid());
    var tx = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      var pending =
          new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<Object>>();
      tx.execute(
          status -> {
            db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
            db.queryForList("SELECT id FROM review_item WHERE id=? FOR UPDATE", item);
            pending.set(
                executor.submit(() -> reviews.revoke(alice, pid, Map.of("username", "bob"))));
            assertThrows(
                java.util.concurrent.TimeoutException.class,
                () -> pending.get().get(250, java.util.concurrent.TimeUnit.MILLISECONDS));
            reviews.score(bob, a, ReviewUnitTest.valid());
            return null;
          });
      pending.get().get(10, java.util.concurrent.TimeUnit.SECONDS);
    }
    assertThrows(RuntimeException.class, () -> reviews.score(bob, a, ReviewUnitTest.valid()));
    var decision = ReviewUnitTest.valid();
    decision.put("itemId", item);
    var rejected =
        assertThrows(
            org.springframework.web.server.ResponseStatusException.class,
            () -> reviews.adjudicate(alice, pid, decision));
    assertEquals(400, rejected.getStatusCode().value());
    assertEquals(
        0,
        db.queryForObject(
            "SELECT count(*) FROM review_score WHERE item_id=? AND kind='ADJUDICATION'",
            Integer.class,
            item));
  }
}
