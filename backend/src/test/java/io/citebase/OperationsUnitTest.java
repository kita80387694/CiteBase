package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.sql.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.server.ResponseStatusException;

class OperationsUnitTest {
  @Test
  void localTokenDoesNotAcceptOrdinaryUserAndDoesNotEchoSecret() {
    String token = "0123456789abcdef0123456789abcdef";
    var service =
        new OperationsService(
            mock(JdbcTemplate.class),
            new MockEnvironment().withProperty("OPERATIONS_TOKEN", token),
            new SimpleMeterRegistry());
    assertThrows(ResponseStatusException.class, () -> service.local("ordinary-user-bearer"));
    var result = service.local(token);
    assertEquals("LOCAL_PROCESS", result.get("scope"));
    assertFalse(result.toString().contains(token));
  }

  @Test
  void databaseHealthUsesQueryTimeoutAndDoesNotExposeFailure() throws Exception {
    var source = mock(DataSource.class);
    var connection = mock(Connection.class);
    var statement = mock(Statement.class);
    when(source.getConnection()).thenReturn(connection);
    when(connection.createStatement()).thenReturn(statement);
    when(statement.executeQuery("select 1"))
        .thenThrow(new SQLException("secret connection details"));
    var health = new BoundedDatabaseHealthIndicator(source).health();
    assertEquals("DOWN", health.getStatus().getCode());
    assertTrue(health.getDetails().isEmpty());
    verify(statement).setQueryTimeout(2);
    verify(connection).close();
  }
}
