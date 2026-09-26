package io.citebase;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiErrors {
  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<?> status(ResponseStatusException e) {
    return ResponseEntity.status(e.getStatusCode())
        .body(Map.of("message", e.getReason() == null ? "请求失败" : e.getReason()));
  }

  @ExceptionHandler({
    IllegalArgumentException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class
  })
  ResponseEntity<?> bad(Exception e) {
    return ResponseEntity.badRequest().body(Map.of("message", "请求参数无效"));
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ResponseEntity<?> large(Exception e) {
    return ResponseEntity.status(413).body(Map.of("message", "文件不得超过 10MB"));
  }
}
