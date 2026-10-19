package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.utility.DockerImageName;

@Testcontainers(disabledWithoutDocker = true)
class TaskMigrationIntegrationTest {
  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
          DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
              .asCompatibleSubstituteFor("postgres"));

  @Test
  void v5UpgradePreservesSourcesPublishedIndexAndCompletedArtifacts() {
    var ds =
        new DriverManagerDataSource(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    Flyway.configure().dataSource(ds).target("5").load().migrate();
    var db = new JdbcTemplate(ds);
    db.update("insert into app_user values('u','legacy','hash')");
    db.update("insert into knowledge_base(id,user_id,name) values('kb','u','legacy')");
    db.update(
        "insert into document(id,kb_id,name,status,active_version_id)"
            + " values('doc','kb','keep.md','SUCCESS','v1')");
    db.update(
        "insert into document_version(id,document_id,content_hash,source,media_type,status)"
            + " values('v1','doc','hash',?,'md','SUCCESS')",
        "original source".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    db.update(
        "insert into"
            + " chunk(id,version_id,document_id,page,paragraph,start_offset,end_offset,content,content_hash,embedding,lexical,embedding_model)"
            + " values('c','v1','doc',1,1,0,15,'original source','hash','[1,0]','original"
            + " source','old-embedding')");
    db.update(
        "insert into index_task(id,document_id,version_id,status,attempts)"
            + " values('done','doc','v1','SUCCESS',1),('failed','doc','v1','FAILED',3),('interrupted','doc','v1','PROCESSING',2)");
    db.update(
        "insert into evaluation_run(id,user_id,kb_id,name,status,payload)"
            + " values('eval','u','kb','historical','COMPLETED','{\"rows\":[{\"answerCorrect\":null,\"error\":\"original\"}]}')");
    db.update(
        "insert into"
            + " agent_run(id,user_id,kb_id,idempotency_key,request_hash,status,request,config,snapshot,result)"
            + " values('agent','u','kb','key','hash','COMPLETED','{}','{}','[]','{\"answer\":\"original\"}')");
    String
        eval =
            db.queryForObject(
                "select payload::text from evaluation_run where id='eval'", String.class),
        agent =
            db.queryForObject("select result::text from agent_run where id='agent'", String.class);
    Flyway.configure().dataSource(ds).target("6").load().migrate();
    assertEquals(3, db.queryForObject("select count(*) from work_task", Integer.class));
    assertEquals(
        "SUCCEEDED",
        db.queryForObject("select status from work_task where id='done'", String.class));
    assertEquals(
        "FAILED",
        db.queryForObject("select status from work_task where id='failed'", String.class));
    var interrupted =
        db.queryForMap("select status,attempts,error_code from work_task where id='interrupted'");
    assertEquals("QUEUED", interrupted.get("status"));
    assertEquals(2, interrupted.get("attempts"));
    assertEquals("UPGRADE_INTERRUPTED", interrupted.get("error_code"));
    assertEquals(
        "v1",
        db.queryForObject("select active_version_id from document where id='doc'", String.class));
    assertArrayEquals(
        "original source".getBytes(java.nio.charset.StandardCharsets.UTF_8),
        db.queryForObject("select source from document_version where id='v1'", byte[].class));
    assertEquals(
        "original source",
        db.queryForObject("select content from chunk where id='c'", String.class));
    assertEquals(
        eval,
        db.queryForObject(
            "select payload::text from evaluation_run where id='eval'", String.class));
    assertEquals(
        agent,
        db.queryForObject("select result::text from agent_run where id='agent'", String.class));
    Flyway.configure().dataSource(ds).target("6").load().migrate();
    assertEquals(3, db.queryForObject("select count(*) from work_task", Integer.class));
  }
}
