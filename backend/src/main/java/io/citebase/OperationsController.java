package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/operations")
public class OperationsController {
  private final AuthService auth;
  private final OperationsService operations;

  public OperationsController(AuthService auth, OperationsService operations) {
    this.auth = auth;
    this.operations = operations;
  }

  @GetMapping("/summary")
  Object summary(HttpServletRequest request, @RequestParam(defaultValue = "60") int windowMinutes) {
    return operations.summary(auth.require(request), windowMinutes);
  }

  @GetMapping("/local")
  Object local(@RequestHeader(value = "X-Operations-Token", required = false) String token) {
    return operations.local(token);
  }
}
