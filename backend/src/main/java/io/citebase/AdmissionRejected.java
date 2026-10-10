package io.citebase;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class AdmissionRejected extends ResponseStatusException {
  private final int retryAfter;

  AdmissionRejected(int retryAfter) {
    super(HttpStatus.TOO_MANY_REQUESTS, "服务繁忙，请稍后重试");
    this.retryAfter = retryAfter;
  }

  int retryAfter() { return retryAfter; }
}
