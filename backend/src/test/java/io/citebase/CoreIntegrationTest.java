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
class CoreIntegrationTest extends CoreScenarios {
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
}
