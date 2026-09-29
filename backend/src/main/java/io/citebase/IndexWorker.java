package io.citebase;

import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

@Component
public class IndexWorker implements TaskHandler {
  private final JdbcTemplate db;
  private final DocumentParser parser;
  private final ModelGateway model;
  private final TaskRepository tasks;
  private final ObjectProvider<TaskWorker> worker;

  public IndexWorker(
      JdbcTemplate db,
      DocumentParser parser,
      ModelGateway model,
      TaskRepository tasks,
      ObjectProvider<TaskWorker> worker) {
    this.db = db;
    this.parser = parser;
    this.model = model;
    this.tasks = tasks;
    this.worker = worker;
  }

  public TaskKind kind() {
    return TaskKind.INDEX;
  }

  public TaskLock publicationLock() {
    return TaskLock.EXCLUSIVE_SOURCE;
  }

  public boolean processOne() {
    return worker.getObject().processOne(Set.of(kind()));
  }

  /**
   * Compatibility entry: startup never rewrites another process's lease. Expired work is claimed
   * normally.
   */
  public void recover() {}

  @SuppressWarnings("unchecked")
  private Map<String, Object> payload(TaskLease l) {
    return (Map<String, Object>) l.payload();
  }

  private Map<String, Object> source(TaskLease l) {
    var p = payload(l);
    var rows =
        db.queryForList(
            "select v.*,d.kb_id from document_version v join document d on d.id=v.document_id join"
                + " knowledge_base k on k.id=d.kb_id where v.id=? and d.id=? and d.kb_id=? and"
                + " k.user_id=?",
            p.get("versionId"),
            p.get("documentId"),
            l.kbId(),
            l.userId());
    if (rows.isEmpty()) throw new TaskSignal("DELETED");
    var v = rows.getFirst();
    if (!Objects.equals(v.get("content_hash"), p.get("sourceHash")))
      throw new TaskSignal("SOURCE_CHANGED");
    if (p.containsKey("chunkProfile")
        && !p.get("chunkProfile")
            .equals(
                Map.of(
                    "strategy",
                    v.get("chunk_strategy"),
                    "size",
                    v.get("chunk_size"),
                    "overlap",
                    v.get("chunk_overlap")))) throw new TaskSignal("SOURCE_CHANGED");
    return v;
  }

  public Map<String, Object> modelSnapshot() {
    return Map.of(
        "mode",
        model.mode(),
        "embeddingModel",
        model.embeddingModel(),
        "provider",
        model.configuration());
  }

  public TaskResult execute(TaskContext ctx) throws Exception {
    var l = ctx.lease();
    var p = payload(l);
    Object expected = p.get("modelConfig");
    if (expected == null) {
      expected = ctx.checkpoint("modelConfig", Map.class).orElse(null);
      if (expected == null) {
        expected = modelSnapshot();
        ctx.checkpoint("modelConfig", expected);
      }
    }
    if (!expected.equals(modelSnapshot())) throw new TaskSignal("CONFIG_CHANGED");
    var v =
        tasks.guarded(
            l,
            publicationLock(),
            sql -> {
              var found = source(l);
              sql.update(
                  "update index_task set"
                      + " status='PROCESSING',attempts=?,started_at=clock_timestamp(),error=null"
                      + " where id=?",
                  l.attempt(),
                  l.taskId());
              sql.update(
                  "update document set status='PROCESSING',error=null where id=?",
                  p.get("documentId"));
              sql.update(
                  "update document_version set status='PROCESSING' where id=?", p.get("versionId"));
              return found;
            });
    var profile =
        new ChunkProfile(
            v.get("chunk_strategy").toString(),
            ((Number) v.get("chunk_size")).intValue(),
            ((Number) v.get("chunk_overlap")).intValue());
    var parts = parser.parse((byte[]) v.get("source"), v.get("media_type").toString(), profile);
    List<String> keys = new ArrayList<>();
    int completed = 0;
    for (var part : parts) {
      ctx.checkActive();
      String hash = AuthService.hash(part.text().getBytes(java.nio.charset.StandardCharsets.UTF_8));
      String key =
          AuthService.hash(
              tasks
                  .encode(
                      List.of(
                          profile,
                          part.page(),
                          part.paragraph(),
                          part.startOffset(),
                          part.endOffset(),
                          part.headingPath(),
                          hash))
                  .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      keys.add(key);
      if (db.queryForObject(
              "select count(*) from index_chunk_stage where task_id=? and part_key=?",
              Integer.class,
              l.taskId(),
              key)
          == 0) {
        String vector;
        Object usage = null;
        var cached =
            db.queryForList(
                "select embedding::text from chunk where document_id=? and content_hash=? and"
                    + " embedding_model=? and content=? limit 1",
                String.class,
                p.get("documentId"),
                hash,
                model.embeddingModel(),
                part.text());
        if (!cached.isEmpty()) vector = cached.getFirst();
        else {
          var prior = ctx.completedCall("embedding:" + key);
          if (prior.isPresent()) {
            Object response = prior.get().get("response");
            vector = ((Map<?, ?>) response).get("vector").toString();
            usage = prior.get().get("usage");
          } else {
            var call = ctx.beginExternalCall("embedding:" + key, "embedding", hash);
            EmbeddingResult answer;
            try {
              answer = model.embedWithUsage(part.text());
            } catch (SpringAiGateway.ModelFailure failure) {
              String code = ProviderFailures.code(failure);
              if (!Set.of("PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE").contains(code))
                ctx.completeExternalCall(call, null, null);
              throw failure;
            }
            float[] values = answer.vector();
            boolean validVector = values.length > 0;
            for (float n : values) if (!Float.isFinite(n)) validVector = false;
            if (!validVector) {
              ctx.completeExternalCall(call, null, answer.usage());
              throw new TaskSignal("PROVIDER_INVALID_RESPONSE");
            }
            vector = Arrays.toString(values);
            usage = answer.usage();
            ctx.completeExternalCall(call, Map.of("vector", vector), usage);
          }
        }
        String finalVector = vector;
        Object finalUsage = usage;
        tasks.guarded(
            l,
            publicationLock(),
            sql -> {
              source(l);
              sql.update(
                  "insert into"
                      + " index_chunk_stage(task_id,part_key,source_hash,embedding_model,content_hash,page,paragraph,start_offset,end_offset,heading_path,content,embedding,usage)"
                      + " values(?,?,?,?,?,?,?,?,?,?,?,?::vector,?::jsonb) on"
                      + " conflict(task_id,part_key) do nothing",
                  l.taskId(),
                  key,
                  p.get("sourceHash"),
                  model.embeddingModel(),
                  hash,
                  part.page(),
                  part.paragraph(),
                  part.startOffset(),
                  part.endOffset(),
                  part.headingPath(),
                  part.text(),
                  finalVector,
                  finalUsage == null ? null : tasks.encode(finalUsage));
              return null;
            });
      }
      ctx.progress(Map.of("completed", ++completed, "total", parts.size(), "unit", "chunks"));
    }
    return new TaskResult(Map.of("partKeys", keys, "modelConfig", modelSnapshot()));
  }

  public void publish(JdbcTemplate sql, TaskLease l, TaskResult result) {
    var p = payload(l);
    source(l);
    if (!((Map<?, ?>) result.result()).get("modelConfig").equals(modelSnapshot()))
      throw new TaskSignal("CONFIG_CHANGED");
    ensureLatest(sql, p);
    var keys = (List<?>) ((Map<?, ?>) result.result()).get("partKeys");
    var rows =
        sql.queryForList(
            "select * from index_chunk_stage where task_id=? order by"
                + " page,paragraph,start_offset,part_key",
            l.taskId());
    if (rows.size() != keys.size()
        || !rows.stream()
            .map(r -> r.get("part_key"))
            .collect(java.util.stream.Collectors.toSet())
            .equals(new HashSet<>(keys))) throw new TaskSignal("CHECKPOINT_INCOMPLETE");
    sql.update("delete from chunk where version_id=?", p.get("versionId"));
    for (var r : rows)
      sql.update(
          "insert into"
              + " chunk(id,version_id,document_id,page,paragraph,start_offset,end_offset,content,content_hash,embedding,lexical,embedding_model,heading_path)"
              + " values(?,?,?,?,?,?,?,?,?,?::vector,?,?,?)",
          UUID.randomUUID().toString(),
          p.get("versionId"),
          p.get("documentId"),
          r.get("page"),
          r.get("paragraph"),
          r.get("start_offset"),
          r.get("end_offset"),
          r.get("content"),
          r.get("content_hash"),
          r.get("embedding").toString(),
          Lexical.tokens(r.get("content").toString()),
          r.get("embedding_model"),
          r.get("heading_path"));
    sql.update("update document_version set status='SUCCESS' where id=?", p.get("versionId"));
    sql.update(
        "update document set active_version_id=?,status='SUCCESS',error=null where id=?",
        p.get("versionId"),
        p.get("documentId"));
    sql.update("update index_task set status='SUCCESS',error=null where id=?", l.taskId());
  }

  private void ensureLatest(JdbcTemplate sql, Map<?, ?> p) {
    if (sql.queryForObject(
            "select count(*) from document_version newer join document_version old on old.id=?"
                + " where newer.document_id=old.document_id and newer.created_at>old.created_at",
            Integer.class,
            p.get("versionId"))
        > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "仅可处理最新文档版本");
  }

  public void onFailure(JdbcTemplate sql, TaskLease l, TaskFailure f, TaskState next) {
    var p = payload(l);
    String status =
        switch (next) {
          case RETRY_WAIT -> "RETRY";
          case CANCEL_REQUESTED -> "PROCESSING";
          case CANCELLED -> "CANCELLED";
          default -> "FAILED";
        };
    sql.update(
        "update index_task set status=?,attempts=?,error=?,available_at=clock_timestamp()+interval"
            + " '3 seconds' where id=?",
        status,
        l.attempt(),
        f.safeMessage(),
        l.taskId());
    sql.update(
        "update document_version set status=? where id=?",
        next == TaskState.CANCEL_REQUESTED
            ? "PROCESSING"
            : next == TaskState.RETRY_WAIT ? "PENDING" : status,
        p.get("versionId"));
    sql.update(
        "update document set status=?,error=? where id=?",
        next == TaskState.RETRY_WAIT ? "PENDING" : status,
        f.safeMessage(),
        p.get("documentId"));
  }

  public void validateRetry(JdbcTemplate sql, Map<String, Object> owned) {
    var p = (Map<?, ?>) owned.get("payload");
    ensureLatest(sql, p);
    if (sql.queryForObject(
            "select count(*) from work_task where kind='INDEX' and payload->>'documentId'=? and"
                + " id<>? and status in ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED')",
            Integer.class,
            p.get("documentId"),
            owned.get("id"))
        > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "文档已有运行任务");
  }

  public void onQueued(JdbcTemplate sql, TaskLease l) {
    var p = payload(l);
    sql.update(
        "update index_task set"
            + " status='PENDING',attempts=0,error=null,available_at=clock_timestamp() where id=?",
        l.taskId());
    sql.update("update document_version set status='PENDING' where id=?", p.get("versionId"));
    sql.update("update document set status='PENDING',error=null where id=?", p.get("documentId"));
  }
}
