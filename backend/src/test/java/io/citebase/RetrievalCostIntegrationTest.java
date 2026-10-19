package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@SuppressWarnings("unchecked")
class RetrievalCostIntegrationTest extends Stage2RetrievalIntegrationTest {
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean RerankGateway reranker;
  @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;

  RetrievalOptions cached() {
    return new RetrievalOptions(3, 1d, false, "uuid", null, false, true);
  }

  String cacheStatus(RetrievalOutcome outcome) {
    return ((Map<?, ?>) ((Map<?, ?>) outcome.diagnostics().get("cost")).get("cache"))
        .get("status")
        .toString();
  }

  @Test
  void cacheHitMakesNoEmbeddingCallAndCannotReuseGenerationFields() {
    var q = questions.ask(alice, kb, "alpha port", "vector", 1, false, cached());
    assertTrue(q.diagnostics().containsKey("rawAnswer"));
    var hit = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    assertEquals("HIT", cacheStatus(hit));
    assertFalse(hit.diagnostics().containsKey("rawAnswer"));
    assertFalse(((Map<?, ?>) hit.diagnostics().get("timings")).containsKey("generationMs"));
    assertNull(hit.usage().get("embedding"));
    assertEquals(
        Map.of("embedding", 0, "rerank", 0),
        ((Map<?, ?>) hit.diagnostics().get("cost")).get("currentProviderCalls"));
    verify(model, times(1)).embedWithUsage("alpha port");
  }

  @Test
  void ownerKnowledgeBaseModeOptionsAndModelSeparateEntries() {
    retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    assertThrows(
        RuntimeException.class,
        () -> retrieval.retrieveDetailed(bob, kb, "alpha port", "vector", 1, cached()));
    var otherUser = retrieval.retrieveDetailed(bob, other, "alpha port", "vector", 1, cached());
    assertEquals("MISS", cacheStatus(otherUser));
    assertTrue(questions.encode(otherUser.evidence()).contains("4444"));
    assertEquals(
        "MISS",
        cacheStatus(retrieval.retrieveDetailed(alice, kb, "alpha port", "hybrid", 1, cached())));
    assertEquals(
        "MISS",
        cacheStatus(retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 2, cached())));
    doReturn(Map.of("provider", "changed-model-public-config")).when(model).configuration();
    assertEquals(
        "MISS",
        cacheStatus(retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached())));
  }

  @Test
  void deletionAfterWarmCacheCannotExposeAnyTraceCandidate() {
    retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    String doc = db.queryForObject("SELECT id FROM document WHERE kb_id=?", String.class, kb);
    documents.delete(alice, doc);
    var empty = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    assertTrue(empty.evidence().isEmpty());
    assertFalse(questions.encode(empty.diagnostics()).contains("9081"));
  }

  @Test
  void evaluationSnapshotCacheSurvivesActiveUpdateButNotDeletion() {
    var dataset =
        new EvaluationService.Dataset(
            "snapshot-cost",
            List.of(new EvaluationService.Case("q", "unknown?", false, null, List.of())));
    var evaluation =
        evaluations.create(
            alice, new EvaluationService.Request(kb, "snapshot-cost", dataset, 1, cached()));
    String eid = evaluation.get("id").toString();
    var first = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached(), eid);
    assertEquals("MISS", cacheStatus(first));
    String doc = db.queryForObject("SELECT id FROM document WHERE kb_id=?", String.class, kb);
    documents.upload(
        alice,
        kb,
        doc,
        "policy.md",
        "alpha port changed to 7777".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    worker.processOne();
    var frozen = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached(), eid);
    assertEquals("HIT", cacheStatus(frozen));
    assertEquals(first.evidence().getFirst().versionId(), frozen.evidence().getFirst().versionId());
    var active = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    assertEquals("MISS", cacheStatus(active));
    assertNotEquals(
        first.evidence().getFirst().versionId(), active.evidence().getFirst().versionId());
    db.update("DELETE FROM evaluation_run WHERE id=?", eid);
    assertThrows(
        RuntimeException.class,
        () -> retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached(), eid));
  }

  @Test
  void failedProviderResponseIsNeverCached() {
    doThrow(new SpringAiGateway.ModelFailure("PROVIDER_TIMEOUT", null))
        .when(model)
        .embedWithUsage("alpha port");
    assertEquals(
        "PROVIDER_TIMEOUT",
        retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached()).error());
    assertEquals(
        "PROVIDER_TIMEOUT",
        retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached()).error());
    verify(model, times(2)).embedWithUsage("alpha port");
  }

  @Test
  void conditionalRerankSkipsSmallCandidateSetAndAlwaysStillCalls() {
    var conditional =
        new RetrievalOptions(1, 1d, true, "uuid", "candidate-pressure-v1", false, false);
    var skipped = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, conditional);
    assertNull(skipped.error());
    assertEquals(
        "SKIPPED_CANDIDATE_PRESSURE",
        ((Map<?, ?>) skipped.diagnostics().get("cost")).get("rerankDecision"));
    verify(reranker, never()).rerank(anyString(), anyList(), anyInt());
    var original =
        retrieval.retrieveDetailed(
            alice, kb, "alpha port", "vector", 1, new RetrievalOptions(1, 1d, true, "uuid"));
    assertNotNull(original.error());
    verify(reranker, times(1)).rerank(anyString(), anyList(), anyInt());
  }

  @Test
  void duplicateTextIsSentOnceButBothSourceIdentitiesRemain() {
    String doc = db.queryForObject("SELECT id FROM document WHERE kb_id=?", String.class, kb);
    db.update(
        "INSERT INTO"
            + " chunk(id,version_id,document_id,page,paragraph,start_offset,end_offset,content,content_hash,embedding,lexical,embedding_model)"
            + " SELECT"
            + " ?,version_id,document_id,page,paragraph,start_offset,end_offset,content,content_hash,embedding,lexical,embedding_model"
            + " FROM chunk WHERE document_id=? ORDER BY id LIMIT 1",
        UUID.randomUUID().toString(),
        doc);
    doReturn(Map.of("configured", true)).when(reranker).configuration();
    doAnswer(
            i -> {
              List<Evidence> docs = i.getArgument(1);
              int top = i.getArgument(2);
              assertEquals(
                  docs.size(), new HashSet<>(docs.stream().map(Evidence::text).toList()).size());
              return new RerankGateway.Result(
                  java.util.stream.IntStream.range(0, Math.min(top, docs.size()))
                      .mapToObj(n -> new RerankGateway.Ranked(n, 1d - n * .1))
                      .toList(),
                  Map.of("promptTokens", 17));
            })
        .when(reranker)
        .rerank(anyString(), anyList(), anyInt());
    var result =
        retrieval.retrieveDetailed(
            alice,
            kb,
            "alpha port",
            "vector",
            4,
            new RetrievalOptions(4, 1d, true, "uuid", null, true, false));
    assertNull(result.error());
    assertEquals(4, result.evidence().size());
    var cost = (Map<?, ?>) result.diagnostics().get("cost");
    assertEquals(3, cost.get("uniqueRerankInputs"));
    assertEquals(4, cost.get("rawCandidateCount"));
    assertEquals(17, ((Map<?, ?>) result.usage().get("rerank")).get("promptTokens"));
  }

  @Test
  void effectiveCandidateLimitSeparatesImplicitAndExplicitDefaults() {
    var implicit = new RetrievalOptions(null, 1d, false, "uuid", null, false, true);
    var explicit = new RetrievalOptions(20, 1d, false, "uuid", null, false, true);
    var small = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, implicit);
    var large = retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, explicit);
    assertEquals("MISS", cacheStatus(small));
    assertEquals("MISS", cacheStatus(large));
    assertEquals(1, ((Map<?, ?>) small.diagnostics().get("candidateCounts")).get("vector"));
    assertEquals(3, ((Map<?, ?>) large.diagnostics().get("candidateCounts")).get("vector"));
  }

  @Test
  void invalidProviderMappingFailsAndIsNotCached() {
    doReturn(Map.of("configured", true)).when(reranker).configuration();
    doReturn(new RerankGateway.Result(List.of(new RerankGateway.Ranked(999, 1d)), null))
        .when(reranker)
        .rerank(anyString(), anyList(), anyInt());
    var options = new RetrievalOptions(3, 1d, true, "uuid", null, true, true);
    for (int i = 0; i < 2; i++)
      assertEquals(
          "PROVIDER_INVALID_RESPONSE",
          retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, options).error());
    verify(reranker, times(2)).rerank(anyString(), anyList(), anyInt());
  }

  @Test
  void warmReadSerializesWithActualDatabaseDeletion() throws Exception {
    retrieval.retrieveDetailed(alice, kb, "alpha port", "vector", 1, cached());
    var tx = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      var pending =
          new java.util.concurrent.atomic.AtomicReference<
              java.util.concurrent.Future<RetrievalOutcome>>();
      tx.execute(
          status -> {
            db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", kb);
            pending.set(
                executor.submit(
                    () ->
                        retrieval.retrieveDetailed(
                            alice, kb, "alpha port", "vector", 1, cached())));
            assertThrows(
                java.util.concurrent.TimeoutException.class,
                () -> pending.get().get(200, java.util.concurrent.TimeUnit.MILLISECONDS));
            db.update("DELETE FROM knowledge_base WHERE id=?", kb);
            return null;
          });
      var failure =
          assertThrows(
              java.util.concurrent.ExecutionException.class,
              () -> pending.get().get(5, java.util.concurrent.TimeUnit.SECONDS));
      assertInstanceOf(
          org.springframework.web.server.ResponseStatusException.class, failure.getCause());
    }
  }

  @Test
  void publicCostConfigurationIsAvailableWithoutProviderCallsAndLegacyUnchanged() {
    assertFalse(questions.config(1, null).containsKey("retrievalCost"));
    var config = (Map<?, ?>) questions.config(1, cached()).get("retrievalCost");
    assertEquals("retrieval-cost-v1", config.get("version"));
    assertEquals(300L, ((Map<?, ?>) config.get("cache")).get("ttlSeconds"));
    verify(model, never()).embedWithUsage(anyString());
    verify(reranker, never()).rerank(anyString(), anyList(), anyInt());
  }
}
