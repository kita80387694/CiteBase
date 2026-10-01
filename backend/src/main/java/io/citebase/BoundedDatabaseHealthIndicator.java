package io.citebase;

import javax.sql.DataSource;
import org.springframework.boot.actuate.health.*;
import org.springframework.stereotype.Component;

@Component("boundedDatabase")
public class BoundedDatabaseHealthIndicator implements HealthIndicator {
  private final DataSource source;

  public BoundedDatabaseHealthIndicator(DataSource source) {
    this.source = source;
  }

  public Health health() {
    // Hikari acquisition is bounded separately by connection-timeout (2500 ms).
    try (var connection = source.getConnection();
        var statement = connection.createStatement()) {
      statement.setQueryTimeout(2);
      try (var result = statement.executeQuery("select 1")) {
        return result.next() ? Health.up().build() : Health.down().build();
      }
    } catch (Exception e) {
      return Health.down().build();
    }
  }
}
