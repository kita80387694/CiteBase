package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

abstract class CoreScenarios {
  @Autowired JdbcTemplate db;
  @Autowired DocumentService docs;
  @Autowired AccessService access;
  @Autowired AuthService auth;
  @Autowired IndexWorker worker;
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean ModelGateway model;
  String alice, bob, kb;

  @AfterEach
  void resetModel() {
    org.mockito.Mockito.reset(model);
  }

  @Test
  void deletionDuringEmbeddingCannotResurrectDocument() throws Exception {
    String doc =
        (String)
            docs.upload(
                    alice, kb, null, "slow.md", "slow evidence".getBytes(StandardCharsets.UTF_8))
                .get("id");
    var entered = new java.util.concurrent.CountDownLatch(1);
    var release = new java.util.concurrent.CountDownLatch(1);
    org.mockito.Mockito.doAnswer(
            call -> {
              entered.countDown();
              if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                throw new IllegalStateException("test latch timeout");
              return call.callRealMethod();
            })
        .when(model)
        .embed("slow evidence");
    try (var pool = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      var task = pool.submit(() -> worker.processOne());
      assertTrue(entered.await(10, java.util.concurrent.TimeUnit.SECONDS));
      try {
        docs.delete(alice, doc);
      } finally {
        release.countDown();
      }
      assertTrue(task.get(10, java.util.concurrent.TimeUnit.SECONDS));
    }
    assertEquals(
        0, db.queryForObject("select count(*) from document where id=?", Integer.class, doc));
    assertEquals(
        0, db.queryForObject("select count(*) from chunk where document_id=?", Integer.class, doc));
  }

  @Test
  void exhaustedInterruptedTaskDoesNotRetryForever() {
    String doc =
        (String)
            docs.upload(
                    alice,
                    kb,
                    null,
                    "interrupt.md",
                    "some evidence".getBytes(StandardCharsets.UTF_8))
                .get("id");
    db.update("update index_task set status='PROCESSING',attempts=3 where document_id=?", doc);
    db.update("update document set status='PROCESSING' where id=?", doc);
    worker.recover();
    assertEquals(
        "FAILED",
        db.queryForObject("select status from index_task where document_id=?", String.class, doc));
    assertEquals("FAILED", docs.view(doc).get("status"));
    assertFalse(worker.processOne());
  }

  @Test
  void transientFailureRetriesAndReusesUnchangedEmbeddings() {
    String doc =
        (String)
            docs.upload(
                    alice,
                    kb,
                    null,
                    "retry.md",
                    "stable paragraph\n\nold paragraph".getBytes(StandardCharsets.UTF_8))
                .get("id");
    org.mockito.Mockito.doThrow(new RuntimeException("timeout"))
        .doCallRealMethod()
        .when(model)
        .embed("stable paragraph");
    worker.processOne();
    assertEquals(
        "RETRY",
        db.queryForObject("select status from index_task where document_id=?", String.class, doc));
    assertNull(docs.view(doc).get("activeVersionId"));
    db.update("update index_task set available_at=now()");
    worker.processOne();
    assertEquals("SUCCESS", docs.view(doc).get("status"));
    org.mockito.Mockito.clearInvocations(model);
    docs.upload(
        alice,
        kb,
        doc,
        "retry.md",
        "stable paragraph\n\nnew paragraph".getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never()).embed("stable paragraph");
    org.mockito.Mockito.verify(model).embed("new paragraph");
  }

  @Test
  void concurrentUploadsDeduplicateAndDeletionRevokesCitation() throws Exception {
    var start = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.Callable<String> upload =
        () -> {
          start.await();
          return (String)
              docs.upload(
                      alice,
                      kb,
                      null,
                      "same.md",
                      "atomic evidence".getBytes(StandardCharsets.UTF_8))
                  .get("id");
        };
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var one = pool.submit(upload);
      var two = pool.submit(upload);
      start.countDown();
      assertEquals(one.get(), two.get());
    }
    worker.processOne();
    String doc = db.queryForObject("select id from document where kb_id=?", String.class, kb);
    String chunk =
        db.queryForObject("select id from chunk where document_id=? limit 1", String.class, doc);
    assertEquals(
        1,
        db.queryForObject(
            "select count(*) from chunk c join document d on d.active_version_id=c.version_id join"
                + " knowledge_base k on k.id=d.kb_id where c.id=? and k.user_id=?",
            Integer.class,
            chunk,
            alice));
    assertEquals(
        0,
        db.queryForObject(
            "select count(*) from chunk c join document d on d.active_version_id=c.version_id join"
                + " knowledge_base k on k.id=d.kb_id where c.id=? and k.user_id=?",
            Integer.class,
            chunk,
            bob));
    docs.delete(alice, doc);
    assertEquals(
        0, db.queryForObject("select count(*) from chunk where id=?", Integer.class, chunk));
  }

  @BeforeEach
  void setup() {
    db.update("delete from knowledge_base");
    alice = (String) auth.login("alice", "Alice-demo-123!").get("userId");
    bob = (String) auth.login("bob", "Bob-demo-123!").get("userId");
    kb = java.util.UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,'测试')", kb, alice);
  }

  @Test
  void sessionAndOwnership() {
    var login = auth.login("alice", "Alice-demo-123!");
    var req = new MockHttpServletRequest();
    req.addHeader("Authorization", "Bearer " + login.get("token"));
    assertEquals(alice, auth.require(req));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> access.requireKnowledgeBase(bob, kb));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> auth.login("alice", "bad"));
  }

  @Test
  void duplicateUpdateFailureRecoveryAndDelete() {
    byte[] original = "alpha protocol\n\nbeta policy".getBytes(StandardCharsets.UTF_8);
    String doc = (String) docs.upload(alice, kb, null, "guide.md", original).get("id");
    assertEquals(doc, docs.upload(alice, kb, null, "copy.md", original).get("id"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> docs.upload(bob, kb, null, "x.md", original));
    worker.processOne();
    String v1 = (String) docs.view(doc).get("activeVersionId");
    assertNotNull(v1);
    assertEquals(doc, docs.upload(alice, kb, doc, "guide.md", original).get("id"));
    assertEquals(1, db.queryForObject("select count(*) from document_version", Integer.class));
    docs.upload(alice, kb, doc, "guide.md", new byte[] {(byte) 0xff});
    for (int i = 0; i < 3; i++) {
      db.update("update index_task set available_at=now()");
      worker.processOne();
    }
    assertEquals("FAILED", docs.view(doc).get("status"));
    assertEquals(v1, docs.view(doc).get("activeVersionId"));
    assertEquals(
        2, db.queryForObject("select count(*) from chunk where version_id=?", Integer.class, v1));
    String task =
        db.queryForObject("select id from index_task where status='FAILED'", String.class);
    docs.retry(alice, task);
    db.update("update index_task set status='PROCESSING',attempts=1 where id=?", task);
    worker.recover();
    assertEquals(
        "RETRY", db.queryForObject("select status from index_task where id=?", String.class, task));
    db.update("update index_task set status='FAILED' where id=?", task);
    docs.upload(
        alice,
        kb,
        doc,
        "guide.md",
        "alpha protocol\n\nnew policy".getBytes(StandardCharsets.UTF_8));
    worker.processOne();
    assertNotEquals(v1, docs.view(doc).get("activeVersionId"));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class,
        () -> docs.retry(alice, task));
    assertThrows(
        org.springframework.web.server.ResponseStatusException.class, () -> docs.delete(bob, doc));
    docs.delete(alice, doc);
    assertEquals(0, db.queryForObject("select count(*) from chunk", Integer.class));
    assertEquals(0, db.queryForObject("select count(*) from index_task", Integer.class));
  }
}
