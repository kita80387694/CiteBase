package io.citebase;

import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class CoreController {
  private final AuthService auth;
  private final AccessService access;
  private final JdbcTemplate db;
  private final DocumentService docs;
  private final ModelGateway model;

  public CoreController(
      AuthService auth,
      AccessService access,
      JdbcTemplate db,
      DocumentService docs,
      ModelGateway model) {
    this.auth = auth;
    this.access = access;
    this.db = db;
    this.docs = docs;
    this.model = model;
  }

  @PostMapping("/auth/login")
  Object login(@RequestBody Map<String, String> body) {
    return auth.login(body.get("username"), body.get("password"));
  }

  @GetMapping("/me")
  Object me(HttpServletRequest req) {
    String user = auth.require(req);
    return Map.of(
        "userId",
        user,
        "username",
        db.queryForObject("select username from app_user where id=?", String.class, user),
        "mode",
        model.mode());
  }

  @GetMapping("/knowledge-bases")
  Object bases(HttpServletRequest req) {
    return db.queryForList(
        "select id,name,created_at as \"createdAt\" from knowledge_base where user_id=? order by"
            + " created_at",
        auth.require(req));
  }

  @PostMapping("/knowledge-bases")
  Object create(HttpServletRequest req, @RequestBody Map<String, String> body) {
    String user = auth.require(req), name = body.get("name");
    if (name == null || name.isBlank() || name.length() > 100) throw new IllegalArgumentException();
    String id = UUID.randomUUID().toString();
    db.update("insert into knowledge_base(id,user_id,name) values(?,?,?)", id, user, name.strip());
    return Map.of("id", id, "name", name.strip());
  }

  @DeleteMapping("/knowledge-bases/{id}")
  void deleteBase(HttpServletRequest req, @PathVariable String id) {
    docs.deleteBase(auth.require(req), id);
  }

  @GetMapping("/knowledge-bases/{id}/documents")
  Object documents(HttpServletRequest req, @PathVariable String id) {
    access.requireKnowledgeBase(auth.require(req), id);
    return db.queryForList(
        "select id,name,status,error,active_version_id as \"activeVersionId\",created_at as"
            + " \"createdAt\" from document where kb_id=? order by created_at",
        id);
  }

  @PostMapping("/knowledge-bases/{id}/documents")
  Object upload(
      HttpServletRequest req,
      @PathVariable String id,
      @RequestParam MultipartFile file,
      @RequestParam(required = false) String documentId)
      throws java.io.IOException {
    return docs.upload(
        auth.require(req), id, documentId, file.getOriginalFilename(), file.getBytes());
  }

  @DeleteMapping("/documents/{id}")
  void deleteDoc(HttpServletRequest req, @PathVariable String id) {
    docs.delete(auth.require(req), id);
  }

  @GetMapping("/documents/{id}/versions")
  Object versions(HttpServletRequest req, @PathVariable String id) {
    access.requireDocument(auth.require(req), id);
    return db.queryForList(
        "select id,content_hash as \"contentHash\",status,created_at as \"createdAt\" from"
            + " document_version where document_id=? order by created_at",
        id);
  }

  @GetMapping("/tasks")
  Object tasks(HttpServletRequest req) {
    return db.queryForList(
        "select t.id,t.document_id as \"documentId\",d.name as"
            + " \"documentName\",t.status,t.attempts,t.error,t.created_at as \"createdAt\" from"
            + " index_task t join document d on d.id=t.document_id join knowledge_base k on"
            + " k.id=d.kb_id where k.user_id=? order by t.created_at desc",
        auth.require(req));
  }

  @PostMapping("/tasks/{id}/retry")
  void retry(HttpServletRequest req, @PathVariable String id) {
    docs.retry(auth.require(req), id);
  }
}
