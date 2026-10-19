package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class EvaluationMigrationTest {
  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
          org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
              .asCompatibleSubstituteFor("postgres"));

  @Test
  void v5UpgradePreservesRawPayloadAndMarksOnlyLegacyRunning() throws Exception {
    Flyway.configure()
        .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
        .locations("classpath:db/migration")
        .target("5")
        .load()
        .migrate();
    try (var connection =
            DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        var sql = connection.createStatement()) {
      sql.execute(
          "INSERT INTO app_user(id,username,password_hash)"
              + " VALUES('migration-user','migration-user','fixture')");
      sql.execute(
          "INSERT INTO knowledge_base(id,user_id,name)"
              + " VALUES('migration-kb','migration-user','fixture')");
      sql.execute(
          "INSERT INTO evaluation_run(id,user_id,kb_id,name,status,payload)"
              + " VALUES('running','migration-user','migration-kb','running','RUNNING','{\"status\":\"RUNNING\",\"results\":[{\"caseId\":\"saved\",\"error\":null}]}'),('completed','migration-user','migration-kb','completed','COMPLETED','{\"status\":\"COMPLETED\",\"results\":[]}')");
      String before;
      try (var row =
          sql.executeQuery("SELECT payload::text FROM evaluation_run WHERE id='running'")) {
        row.next();
        before = row.getString(1);
      }
      Flyway.configure()
          .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
          .locations("classpath:db/migration")
          .load()
          .migrate();
      try (var row =
          sql.executeQuery(
              "SELECT status,migration_error,payload::text,task_id FROM evaluation_run WHERE"
                  + " id='running'")) {
        assertTrue(row.next());
        assertEquals("FAILED", row.getString(1));
        assertEquals("UPGRADE_INTERRUPTED", row.getString(2));
        assertEquals(before, row.getString(3));
        assertNull(row.getString(4));
      }
      try (var row =
          sql.executeQuery(
              "SELECT status,migration_error,task_id FROM evaluation_run WHERE id='completed'")) {
        assertTrue(row.next());
        assertEquals("COMPLETED", row.getString(1));
        assertNull(row.getString(2));
        assertNull(row.getString(3));
      }
      // Repeating migration must not create tasks or rewrite history.
      assertEquals(
          0,
          Flyway.configure()
              .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
              .locations("classpath:db/migration")
              .load()
              .migrate()
              .migrationsExecuted);
    }
  }
}
