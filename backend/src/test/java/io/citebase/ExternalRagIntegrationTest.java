package io.citebase;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = {"citebase.worker-enabled=false", "MODEL_MODE=mock"})
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class ExternalRagIntegrationTest extends RagScenarios {
  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", () -> System.getenv("TEST_DB_URL"));
    r.add(
        "spring.datasource.username",
        () -> System.getenv().getOrDefault("TEST_DB_USER", "citebase"));
    r.add(
        "spring.datasource.password",
        () -> System.getenv().getOrDefault("TEST_DB_PASSWORD", "citebase-local"));
  }
}
