package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest(properties = {"citebase.worker-enabled=false", "MODEL_MODE=mock"})
@Testcontainers(disabledWithoutDocker = true)
class ChunkingIntegrationTest extends CoreScenarios {
  @Container
  static PostgreSQLContainer<?> postgres =
      new PostgreSQLContainer<>(
              org.testcontainers.utility.DockerImageName.parse("pgvector/pgvector:0.8.2-pg17")
                  .asCompatibleSubstituteFor("postgres"))
          .withDatabaseName("citebase")
          .withUsername("citebase")
          .withPassword("test");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  @Test
  void profileChangesPreserveOldIndexAndReuseOnlyExactEmbeddingInput() throws Exception {
    byte[] source =
        "# Heading\n\nalpha evidence\n\nbeta evidence"
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    String doc = (String) docs.upload(alice, kb, null, "profile.md", source).get("id");
    worker.processOne();
    String old = (String) docs.view(doc).get("activeVersionId");
    var profile = ChunkProfile.of("structure-v1", 900, 200);
    docs.upload(alice, kb, doc, "profile.md", source, profile);
    org.mockito.Mockito.doThrow(new IllegalStateException("temporary provider failure"))
        .when(model)
        .embed(org.mockito.ArgumentMatchers.anyString());
    worker.processOne();
    assertEquals(old, docs.view(doc).get("activeVersionId"));
    org.mockito.Mockito.reset(model);
    db.update("update index_task set available_at=now() where document_id=?", doc);
    db.update("update work_task set available_at=now() where kind='INDEX' and id in (select id from index_task where document_id=?)",doc);
    worker.processOne();
    String active = (String) docs.view(doc).get("activeVersionId");
    assertNotEquals(old, active);
    assertEquals(profile, docs.view(doc).get("activeProfile"));
    assertEquals(
        "# Heading",
        db.queryForObject(
            "select heading_path from chunk where version_id=?", String.class, active));
    assertEquals(
        new String(source, java.nio.charset.StandardCharsets.UTF_8),
        db.queryForObject("select content from chunk where version_id=?", String.class, active));
    docs.upload(alice, kb, doc, "profile.md", source, profile);
    assertEquals(
        2,
        db.queryForObject(
            "select count(*) from document_version where document_id=?", Integer.class, doc));
    docs.upload(alice, kb, doc, "profile.md", source, ChunkProfile.of("structure-v1", 800, 100));
    org.mockito.Mockito.clearInvocations(model);
    worker.processOne();
    org.mockito.Mockito.verify(model, org.mockito.Mockito.never())
        .embed(org.mockito.ArgumentMatchers.anyString());
    assertEquals(
        3,
        db.queryForObject(
            "select count(*) from document_version where document_id=?", Integer.class, doc));
  }

  @org.springframework.beans.factory.annotation.Autowired EvaluationLabels labels;

  @Test
  void originalParagraphLabelsResolveAgainstCrossParagraphIndexedSpan() {
    String source = "# Policy\n\nalpha evidence\n\nbeta evidence";
    String doc =
        (String)
            docs.upload(
                    alice,
                    kb,
                    null,
                    "labels.md",
                    source.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    ChunkProfile.of("structure-v1", 900, 200))
                .get("id");
    worker.processOne();
    var dataset =
        new EvaluationService.Dataset(
            "chunking-test",
            java.util.List.of(
                new EvaluationService.Case(
                    "q",
                    "What is alpha?",
                    true,
                    "alpha evidence",
                    java.util.List.of(
                        new EvaluationMetrics.Label("labels.md", 1, 2, "alpha evidence")))));
    var resolved = labels.resolve(alice, kb, dataset).questions().getFirst().evidence().getFirst();
    String version = (String) docs.view(doc).get("activeVersionId");
    var e =
        db.queryForObject(
            "select id,page,paragraph,start_offset,end_offset,content from chunk where"
                + " version_id=?",
            (rs, n) ->
                new Evidence(
                    rs.getString(1),
                    doc,
                    "labels.md",
                    version,
                    rs.getInt(2),
                    rs.getInt(3),
                    rs.getInt(4),
                    rs.getInt(5),
                    rs.getString(6),
                    1),
            version);
    assertEquals(2, resolved.paragraph());
    assertEquals(1, e.paragraph());
    assertEquals(source.indexOf("alpha evidence"), resolved.startOffset());
    assertTrue(
        EvaluationMetrics.matches(
            resolved,
            e,
            java.util.Map.of(
                version,
                AuthService.hash(source.getBytes(java.nio.charset.StandardCharsets.UTF_8)))));
    assertThrows(
        IllegalArgumentException.class,
        () -> labels.resolve(bob, kb, dataset));
  }
}
