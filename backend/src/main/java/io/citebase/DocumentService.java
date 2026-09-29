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
  private final TaskRepository tasks;
  private final IndexWorker index;
  private final TaskSettings settings;

  public DocumentService(
      JdbcTemplate db,
      AccessService access,
      TaskRepository tasks,
      IndexWorker index,
      TaskSettings settings) {
    this.db = db;
    this.access = access;
    this.tasks = tasks;
    this.index = index;
    this.settings = settings;
  }

  @Transactional
  public Map<String, Object> upload(
      String user, String kb, String documentId, String name, byte[] source) {
    return upload(user, kb, documentId, name, source, ChunkProfile.defaults());
  }

  @Transactional
  public Map<String, Object> upload(
      String user, String kb, String documentId, String name, byte[] source, ChunkProfile profile) {
    lock(kb);
    access.requireKnowledgeBase(user, kb);
    if (profile == null) throw new IllegalArgumentException("切分配置不能为空");
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
                  + " where d.kb_id=? and v.content_hash=? and v.chunk_strategy=? and"
                  + " v.chunk_size=? and v.chunk_overlap=? union select d.id from document d join"
                  + " document_version v on v.document_id=d.id where d.kb_id=? and v.content_hash=?"
                  + " and v.chunk_strategy=? and v.chunk_size=? and v.chunk_overlap=? and v.status"
                  + " in ('PENDING','PROCESSING')",
              String.class,
              kb,
              hash,
              profile.strategy(),
              profile.size(),
              profile.overlap(),
              kb,
              hash,
              profile.strategy(),
              profile.size(),
              profile.overlap());
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
                  + " where d.id=? and v.content_hash=? and v.chunk_strategy=? and v.chunk_size=?"
                  + " and v.chunk_overlap=?",
              Integer.class,
              documentId,
              hash,
              profile.strategy(),
              profile.size(),
              profile.overlap())
          > 0) return view(documentId);
      db.update("update document set status='PENDING',error=null where id=?", documentId);
    }
    String version = UUID.randomUUID().toString();
    db.update(
        "insert into"
            + " document_version(id,document_id,content_hash,source,media_type,status,chunk_strategy,chunk_size,chunk_overlap)"
            + " values(?,?,?,?,?,'PENDING',?,?,?)",
        version,
        documentId,
        hash,
        source,
        type,
        profile.strategy(),
        profile.size(),
        profile.overlap());
    String taskId = UUID.randomUUID().toString();
    db.update(
        "insert into index_task(id,document_id,version_id,status) values(?,?,?,'PENDING')",
        taskId,
        documentId,
        version);
    tasks.enqueue(
        new TaskSpec(
            TaskKind.INDEX,
            user,
            kb,
            taskId,
            taskId,
            Map.of(
                "documentId",
                documentId,
                "versionId",
                version,
                "sourceHash",
                hash,
                "modelConfig",
                index.modelSnapshot(),
                "chunkProfile",
                Map.of(
                    "strategy",
                    profile.strategy(),
                    "size",
                    profile.size(),
                    "overlap",
                    profile.overlap())),
            settings.maxAttempts()));
    return view(documentId);
  }

  public Map<String, Object> view(String id) {
    var result =
        db.queryForMap(
            "select id,name,status,error,active_version_id as \"activeVersionId\",created_at as"
                + " \"createdAt\" from document where id=?",
            id);
    var profiles =
        db.query(
            "select v.chunk_strategy,v.chunk_size,v.chunk_overlap from document_version v join"
                + " document d on d.active_version_id=v.id where d.id=?",
            (r, n) -> new ChunkProfile(r.getString(1), r.getInt(2), r.getInt(3)),
            id);
    result.put("activeProfile", profiles.isEmpty() ? null : profiles.getFirst());
    return result;
  }

  @Transactional
  public void delete(String user, String id) {
    access.requireDocument(user, id);
    String kb = db.queryForObject("select kb_id from document where id=?", String.class, id);
    lock(kb);
    access.requireDocument(user, id);
    db.queryForList("select id from work_task where kb_id=? order by id for update", kb);
    db.update(
        "delete from work_task where kb_id=? and (kind in ('EVALUATION','AGENT') or id in (select"
            + " id from index_task where document_id=?))",
        kb,
        id);
    db.update("delete from question_history where kb_id=?", kb);
    db.update("delete from evaluation_run where kb_id=?", kb);
    db.update("delete from agent_run where kb_id=?", kb);
    db.update("delete from document where id=?", id);
  }

  @Transactional
  public void deleteBase(String user, String kb) {
    lock(kb);
    lock(kb);
    access.requireKnowledgeBase(user, kb);
    db.queryForList("select id from work_task where kb_id=? order by id for update", kb);
    db.update("delete from knowledge_base where id=? and user_id=?", kb, user);
  }

  private void lock(String kb) {
    db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", kb);
  }

  public void retry(String user, String task) {
    if (!"INDEX".equals(tasks.get(user, task).get("kind"))) throw AccessService.missing();
    tasks.retry(user, task);
  }
}
