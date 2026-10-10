package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(properties = {"citebase.worker-enabled=false", "MODEL_MODE=mock",
    "ADMISSION_GLOBAL_TASKS=3", "ADMISSION_USER_TASKS=2", "ADMISSION_SYNC_CONCURRENCY=1"})
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
@org.springframework.test.annotation.DirtiesContext(classMode = org.springframework.test.annotation.DirtiesContext.ClassMode.AFTER_CLASS)
@Testcontainers(disabledWithoutDocker = true)
class AdmissionIntegrationTest {
  @Container static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
      DockerImageName.parse("pgvector/pgvector:0.8.2-pg17").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired JdbcTemplate db;
  @Autowired DocumentService docs;
  @Autowired TaskRepository tasks;
  @Autowired AdmissionService admission;
  @Autowired AuthService auth;
  @Autowired org.springframework.test.web.servlet.MockMvc mvc;
  String alice, bob, kb, token;

  @BeforeEach void setup() {
    db.update("delete from knowledge_base");
    var login = auth.login("alice", "Alice-demo-123!");
    alice = login.get("userId").toString();
    token = login.get("token").toString();
    bob = auth.login("bob", "Bob-demo-123!").get("userId").toString();
    kb = knowledgeBase(alice);
  }

  String knowledgeBase(String user) {
    String id = UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,'admission')", id, user);
    return id;
  }

  String upload(String user, String knowledgeBase, String content) {
    var doc = docs.upload(user, knowledgeBase, null, "admission.md", content.getBytes(StandardCharsets.UTF_8));
    return db.queryForObject("select id from index_task where document_id=?", String.class, doc.get("id"));
  }

  @Test void concurrentUsersCannotExceedGlobalOrUserBoundAndRejectedDomainRowsRollback() throws Exception {
    var start = new CountDownLatch(1);
    var futures = new ArrayList<Future<Boolean>>();
    try (var pool = Executors.newFixedThreadPool(8)) {
      for (int i = 0; i < 8; i++) {
        String user = i % 2 == 0 ? alice : bob;
        String target = knowledgeBase(user);
        futures.add(pool.submit(() -> {
          start.await();
          try { upload(user, target, target); return true; }
          catch (AdmissionRejected expected) { return false; }
        }));
      }
      start.countDown();
      int admitted = 0;
      for (var future : futures) if (future.get(15, TimeUnit.SECONDS)) admitted++;
      assertEquals(3, admitted);
    }
    assertEquals(3, db.queryForObject("select count(*) from work_task", Integer.class));
    assertEquals(3, db.queryForObject("select count(*) from document", Integer.class));
    assertEquals(3, db.queryForObject("select count(*) from document_version", Integer.class));
    assertEquals(3, db.queryForObject("select count(*) from index_task", Integer.class));
    for (var row : db.queryForList("select count(*) as n from work_task group by user_id"))
      assertTrue(((Number) row.get("n")).intValue() <= 2);
  }

  @Test void fullQueueAcceptsIdempotentReplayButRejectsManualRetryUntilSlotReleased() {
    String cancelled = upload(alice, kb, "cancel first");
    tasks.cancel(alice, cancelled);
    String first = upload(alice, kb, "active one");
    var row = db.queryForMap("select * from work_task where id=?", first);
    // Replay exactly the same request object: jsonb is free to reorder stored object keys.
    var spec = new TaskSpec(TaskKind.INDEX, alice, kb, first,
        row.get("idempotency_key").toString(), tasks.decode(row.get("payload")), 3);
    db.update("delete from work_task where id=?", first);
    assertEquals(first, tasks.enqueue(spec));
    upload(alice, kb, "active two");
    assertEquals(first, tasks.enqueue(spec));
    assertThrows(AdmissionRejected.class, () -> tasks.retry(alice, cancelled));
    assertEquals("CANCELLED", tasks.get(alice, cancelled).get("status"));
    // Other users retain their available per-user slot; all active states count globally.
    upload(bob, knowledgeBase(bob), "bob one");
    assertThrows(AdmissionRejected.class, () -> upload(bob, knowledgeBase(bob), "bob two"));
    tasks.cancel(alice, first);
    assertEquals("QUEUED", tasks.retry(alice, cancelled).get("status"));
  }

  @Test void claimedRetryWaitingAndCancellationRequestedTasksContinueConsumingSlots() {
    String first = upload(alice, kb, "first");
    upload(alice, kb, "second");
    var lease = tasks.claim("admission-test", Set.of(TaskKind.INDEX)).orElseThrow();
    assertThrows(AdmissionRejected.class, () -> upload(alice, kb, "third"));
    tasks.cancel(alice, lease.taskId());
    assertThrows(AdmissionRejected.class, () -> upload(alice, kb, "fourth"));
    db.update("update work_task set status='RETRY_WAIT' where id=?", first);
    assertThrows(AdmissionRejected.class, () -> upload(alice, kb, "fifth"));
  }

  @Test void concurrentManualRetriesAndNewUploadsShareTheSameCapacity() throws Exception {
    var owners = new LinkedHashMap<String, String>();
    for (String user : List.of(alice, bob)) {
      for (int i = 0; i < 2; i++) {
        String id = upload(user, knowledgeBase(user), "retry " + i);
        tasks.cancel(user, id);
        owners.put(id, user);
      }
    }
    var start = new CountDownLatch(1);
    var futures = new ArrayList<Future<Boolean>>();
    try (var pool = Executors.newFixedThreadPool(6)) {
      for (var entry : owners.entrySet()) {
        futures.add(pool.submit(() -> {
          start.await();
          try { tasks.retry(entry.getValue(), entry.getKey()); return true; }
          catch (AdmissionRejected expected) { return false; }
        }));
      }
      for (String user : List.of(alice, bob)) {
        String target = knowledgeBase(user);
        futures.add(pool.submit(() -> {
          start.await();
          try { upload(user, target, "new upload"); return true; }
          catch (AdmissionRejected expected) { return false; }
        }));
      }
      start.countDown();
      int admitted = 0;
      for (var future : futures) if (future.get(15, TimeUnit.SECONDS)) admitted++;
      assertEquals(3, admitted);
    }
    assertEquals(3, db.queryForObject(
        "select count(*) from work_task where status='QUEUED'", Integer.class));
    for (var row : db.queryForList(
        "select count(*) as n from work_task where status='QUEUED' group by user_id"))
      assertTrue(((Number) row.get("n")).intValue() <= 2);
    assertEquals(0, db.queryForObject(
        "select count(*) from work_task where status='CANCELLED' and retry_generation<>0", Integer.class));
  }

  @Test void synchronousHttpRejectsImmediatelyAfterAuthorizationWithRetryAfterAndReleasesOnFailure() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var pool = Executors.newSingleThreadExecutor()) {
      var held = pool.submit(() -> admission.synchronous(alice, kb, () -> {
        entered.countDown();
        try { assertTrue(release.await(10, TimeUnit.SECONDS)); }
        catch (InterruptedException e) { throw new RuntimeException(e); }
        return true;
      }));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      try {
        for (String path : List.of("/api/questions", "/api/retrieval-diagnostics")) {
          mvc.perform(post(path).contentType("application/json")
              .content("{\"kbId\":\"" + kb + "\",\"question\":\"test\"}"))
              .andExpect(status().isUnauthorized());
          mvc.perform(post(path).header("Authorization", "Bearer " + token)
              .contentType("application/json").content("{\"kbId\":\"" + kb + "\",\"question\":\"test\"}"))
              .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "3"))
              .andExpect(jsonPath("$.code").value("ADMISSION_REJECTED"));
          mvc.perform(post(path).header("Authorization", "Bearer " + token)
              .contentType("application/json").content("{\"kbId\":\"" + knowledgeBase(bob) + "\",\"question\":\"test\"}"))
              .andExpect(status().isNotFound());
        }
      } finally { release.countDown(); }
      assertTrue(held.get(5, TimeUnit.SECONDS));
    }
    assertThrows(IllegalStateException.class, () -> admission.synchronous(alice, kb, () -> { throw new IllegalStateException(); }));
    assertEquals("released", admission.synchronous(alice, kb, () -> "released"));
  }
}
