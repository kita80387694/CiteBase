package io.citebase;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

class AdmissionUnitTest {
  @Test void limitsCannotBeDisabledOrUnbounded() {
    assertEquals(256, new AdmissionSettings(new MockEnvironment()).globalTasks());
    assertThrows(IllegalArgumentException.class, () -> new AdmissionSettings(0, 1, 1, 1));
    assertThrows(IllegalArgumentException.class, () -> new AdmissionSettings(2, 3, 1, 1));
    assertThrows(IllegalArgumentException.class, () -> new AdmissionSettings(2, 1, 0, 1));
    assertThrows(IllegalArgumentException.class, () -> new AdmissionSettings(2, 1, 1, 0));
  }

  @Test void admissionCannotRunOutsideOwningTransaction() {
    var service = new AdmissionService(new AdmissionSettings(2, 1, 1, 1), mock(JdbcTemplate.class), mock(AccessService.class));
    assertThrows(IllegalStateException.class, () -> service.admitTask("user"));
  }

  @Test void synchronousCapacityRejectsWithoutRunningWorkAndReleasesEvenAfterError() {
    var access = mock(AccessService.class);
    var service = new AdmissionService(new AdmissionSettings(2, 1, 1, 7), mock(JdbcTemplate.class), access);
    assertThrows(AssertionError.class, () -> service.synchronous("user", "kb", () -> {
      var rejected = assertThrows(AdmissionRejected.class, () -> service.synchronous("user", "kb", () -> {
        fail("Rejected work must never execute");
        return null;
      }));
      assertEquals(7, rejected.retryAfter());
      throw new AssertionError("Work failed");
    }));
    assertEquals("released", service.synchronous("user", "kb", () -> "released"));
    verify(access, times(3)).requireKnowledgeBase("user", "kb");
  }
}
