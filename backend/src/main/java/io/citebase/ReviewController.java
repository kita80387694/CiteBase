package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/reviews")
public class ReviewController {
  private final AuthService auth;
  private final ReviewService service;

  public ReviewController(AuthService auth, ReviewService service) {
    this.auth = auth;
    this.service = service;
  }

  @GetMapping("/projects")
  public Object projects(HttpServletRequest r) {
    return service.projects(auth.require(r));
  }

  @PostMapping("/projects")
  public Object create(@RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.create(auth.require(r), b);
  }

  @GetMapping("/projects/{id}")
  public Object get(@PathVariable String id, HttpServletRequest r) {
    return service.project(auth.require(r), id);
  }

  @GetMapping("/projects/{id}/export")
  public Object export(@PathVariable String id, HttpServletRequest r) {
    return service.project(auth.require(r), id);
  }

  @GetMapping("/projects/{id}/items/{item}")
  public Object item(@PathVariable String id, @PathVariable String item, HttpServletRequest r) {
    return service.ownerItem(auth.require(r), id, item);
  }

  @PostMapping("/projects/{id}/assign")
  public Object assign(
      @PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.assign(auth.require(r), id, b);
  }

  @PostMapping("/projects/{id}/revoke")
  public Object revoke(
      @PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.revoke(auth.require(r), id, b);
  }

  @GetMapping("/assignments")
  public Object assignments(HttpServletRequest r) {
    return service.assignments(auth.require(r));
  }

  @GetMapping("/assignments/{id}")
  public Object assignment(@PathVariable String id, HttpServletRequest r) {
    return service.assignment(auth.require(r), id);
  }

  @PostMapping("/assignments/{id}/scores")
  public Object score(
      @PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.score(auth.require(r), id, b);
  }

  @PostMapping("/projects/{id}/adjudications")
  public Object adjudicate(
      @PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.adjudicate(auth.require(r), id, b);
  }

  @PostMapping("/scores/import")
  public Object imports(@RequestBody Map<String, Object> b, HttpServletRequest r) {
    return service.importScores(auth.require(r), b);
  }
}
