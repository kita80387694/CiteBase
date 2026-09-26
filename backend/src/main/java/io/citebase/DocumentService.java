package io.citebase;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class DocumentService {
  private final JdbcTemplate db;
  private final AccessService access;

  public DocumentService(JdbcTemplate db, AccessService access) {
    this.db = db;
    this.access = access;
  }

  @Transactional
  public Map<String, Object> upload(
      String user, String kb, String documentId, String name, byte[] source) {
    access.requireKnowledgeBase(user, kb);
    if (name == null
        || name.isBlank()
        || name.length() > 255
        || source.length == 0
        || source.length > 10 * 1024 * 1024) throw new IllegalArgumentException();
    name = name.replace('\\', '/');
    name = name.substring(name.lastIndexOf('/') + 1);
    String type = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    if (!Set.of("pdf", "txt", "md").contains(type))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "仅支持 PDF、Markdown、TXT");
    // Serialize uploads in a knowledge base, including content-level deduplication.
    db.queryForObject("select id from knowledge_base where id=? for update", String.class, kb);
    String hash = AuthService.hash(source);
    if (documentId == null || documentId.isBlank()) {
      var same =
          db.queryForList(
              "select d.id from document d join document_version v on v.id=d.active_version_id"
                  + " where d.kb_id=? and v.content_hash=? union select d.id from document d join"
                  + " document_version v on v.document_id=d.id where d.kb_id=? and v.content_hash=?"
                  + " and v.status in ('PENDING','PROCESSING')",
              String.class,
              kb,
              hash,
              kb,
              hash);
      if (!same.isEmpty()) return view(same.getFirst());
      documentId = UUID.randomUUID().toString();
      db.update(
          "insert into document(id,kb_id,name,status) values(?,?,?,'PENDING')",
          documentId,
          kb,
          name);
    } else {
      access.requireDocument(user, documentId);
      if (!kb.equals(
          db.queryForObject(
              "select kb_id from document where id=? for update", String.class, documentId)))
        throw AccessService.missing();
      if (db.queryForObject(
              "select count(*) from index_task where document_id=? and status in"
                  + " ('PENDING','PROCESSING','RETRY')",
              Integer.class,
              documentId)
          > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "文档仍在处理，请稍后更新");
      if (db.queryForObject(
              "select count(*) from document_version v join document d on d.active_version_id=v.id"
                  + " where d.id=? and v.content_hash=?",
              Integer.class,
              documentId,
              hash)
          > 0) return view(documentId);
      db.update("update document set status='PENDING',error=null where id=?", documentId);
    }
    String version = UUID.randomUUID().toString();
    db.update(
        "insert into document_version(id,document_id,content_hash,source,media_type,status)"
            + " values(?,?,?,?,?,'PENDING')",
        version,
        documentId,
        hash,
        source,
        type);
    db.update(
        "insert into index_task(id,document_id,version_id,status) values(?,?,?,'PENDING')",
        UUID.randomUUID().toString(),
        documentId,
        version);
    return view(documentId);
  }

  public Map<String, Object> view(String id) {
    return db.queryForMap(
        "select id,name,status,error,active_version_id as \"activeVersionId\",created_at as"
            + " \"createdAt\" from document where id=?",
        id);
  }

  @Transactional
  public void delete(String user, String id) {
    access.requireDocument(user, id);
    String kb = db.queryForObject("select kb_id from document where id=?", String.class, id);
    lock(kb);
    access.requireDocument(user, id);
    db.queryForList("select id from index_task where document_id=? for update", id);
    db.update("delete from question_history where kb_id=?", kb);
    db.update("delete from evaluation_run where kb_id=?", kb);
    db.update("delete from document where id=?", id);
  }

  @Transactional
  public void deleteBase(String user, String kb) {
    lock(kb);
    access.requireKnowledgeBase(user, kb);
    db.queryForList(
        "select t.id from index_task t join document d on d.id=t.document_id where d.kb_id=? for"
            + " update of t",
        kb);
    db.update("delete from knowledge_base where id=? and user_id=?", kb, user);
  }

  private void lock(String kb) {
    db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", kb);
  }

  @Transactional
  public void retry(String user, String task) {
    var rows =
        db.queryForList(
            "select t.document_id from index_task t join document d on d.id=t.document_id join"
                + " knowledge_base k on k.id=d.kb_id where t.id=? and k.user_id=?",
            String.class,
            task,
            user);
    if (rows.isEmpty()) throw AccessService.missing();
    String doc = rows.getFirst();
    db.queryForObject("select id from document where id=? for update", String.class, doc);
    if (db.queryForObject(
            "select count(*) from index_task where document_id=? and status in"
                + " ('PENDING','PROCESSING','RETRY')",
            Integer.class,
            doc)
        > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "文档已有运行中的任务");
    // An old failed version must never supersede a newer successful upload.
    int changed =
        db.update(
            "update index_task t set status='PENDING',attempts=0,error=null,available_at=now()"
                + " where id=? and status='FAILED' and not exists(select 1 from document_version"
                + " newer join document_version old on old.id=t.version_id where"
                + " newer.document_id=t.document_id and newer.created_at>old.created_at)",
            task);
    if (changed != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "仅可重试最新失败版本");
    db.update("update document set status='PENDING',error=null where id=?", doc);
  }
}
