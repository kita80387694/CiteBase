package io.citebase;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class IndexWorker {
  private final JdbcTemplate db;
  private final TransactionTemplate tx;
  private final DocumentParser parser;
  private final ModelGateway model;
  private final boolean enabled;

  public IndexWorker(
      JdbcTemplate db,
      TransactionTemplate tx,
      DocumentParser parser,
      ModelGateway model,
      @Value("${citebase.worker-enabled:true}") boolean enabled) {
    this.db = db;
    this.tx = tx;
    this.parser = parser;
    this.model = model;
    this.enabled = enabled;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recover() {
    tx.executeWithoutResult(
        s -> {
          var tasks =
              db.queryForList(
                  "select id,document_id,version_id,attempts from index_task where"
                      + " status='PROCESSING' for update");
          for (var task : tasks) {
            boolean exhausted = ((Number) task.get("attempts")).intValue() >= 3;
            String error = exhausted ? "进程中断且已达最大重试次数" : "进程中断，已恢复任务";
            db.update(
                "update index_task set status=?,error=?,available_at=now() where id=?",
                exhausted ? "FAILED" : "RETRY",
                error,
                task.get("id"));
            db.update(
                "update document_version set status=? where id=?",
                exhausted ? "FAILED" : "PENDING",
                task.get("version_id"));
            db.update(
                "update document set status=?,error=? where id=?",
                exhausted ? "FAILED" : "PENDING",
                error,
                task.get("document_id"));
          }
        });
  }

  @Scheduled(fixedDelay = 1000)
  public void tick() {
    if (enabled) processOne();
  }

  public synchronized boolean processOne() {
    var task =
        tx.execute(
            s -> {
              var rows =
                  db.queryForList(
                      "select t.* from index_task t where status in ('PENDING','RETRY') and"
                          + " available_at<=now() order by created_at for update skip locked limit"
                          + " 1");
              if (rows.isEmpty()) return null;
              var row = rows.getFirst();
              db.update(
                  "update index_task set status='PROCESSING',attempts=attempts+1,started_at=now()"
                      + " where id=?",
                  row.get("id"));
              db.update(
                  "update document set status='PROCESSING' where id=?", row.get("document_id"));
              db.update(
                  "update document_version set status='PROCESSING' where id=?",
                  row.get("version_id"));
              return row;
            });
    if (task == null) return false;
    String id = (String) task.get("id"),
        doc = (String) task.get("document_id"),
        version = (String) task.get("version_id");
    try {
      var versions =
          db.queryForList("select source,media_type from document_version where id=?", version);
      if (versions.isEmpty()) return true;
      var v = versions.getFirst();
      var parts = parser.parse((byte[]) v.get("source"), (String) v.get("media_type"));
      List<Object[]> rows = new ArrayList<>();
      String embeddingModel = model.embeddingModel();
      for (var part : parts) {
        String hash = AuthService.hash(part.text().getBytes(StandardCharsets.UTF_8));
        var previous =
            db.queryForList(
                "select embedding::text from chunk where document_id=? and content_hash=? and"
                    + " embedding_model=? limit 1",
                String.class,
                doc,
                hash,
                embeddingModel);
        String vector;
        if (previous.isEmpty()) {
          float[] values = model.embed(part.text());
          if (values.length == 0) throw new IllegalArgumentException("embedding 返回空向量");
          for (float value : values)
            if (!Float.isFinite(value)) throw new IllegalArgumentException("embedding 含非有限数值");
          vector = Arrays.toString(values);
        } else vector = previous.getFirst();
        rows.add(
            new Object[] {
              UUID.randomUUID().toString(),
              version,
              doc,
              part.page(),
              part.paragraph(),
              part.startOffset(),
              part.endOffset(),
              part.text(),
              hash,
              vector,
              Lexical.tokens(part.text()),
              embeddingModel
            });
      }
      tx.executeWithoutResult(
          s -> {
            var kbs = db.queryForList("select kb_id from document where id=?", String.class, doc);
            if (kbs.isEmpty()) return;
            db.queryForList("select pg_advisory_xact_lock(hashtextextended(?,0))", kbs.getFirst());
            if (db.queryForList("select id from document where id=? for update", String.class, doc)
                .isEmpty()) return;
            db.update("delete from chunk where version_id=?", version);
            db.batchUpdate(
                "insert into"
                    + " chunk(id,version_id,document_id,page,paragraph,start_offset,end_offset,content,content_hash,embedding,lexical,embedding_model)"
                    + " values(?,?,?,?,?,?,?,?,?,?::vector,?,?)",
                rows);
            db.update("update document_version set status='SUCCESS' where id=?", version);
            db.update(
                "update document set active_version_id=?,status='SUCCESS',error=null where id=?",
                version,
                doc);
            db.update("update index_task set status='SUCCESS',error=null where id=?", id);
          });
    } catch (Exception e) {
      String error = safeError(e);
      tx.executeWithoutResult(
          s -> {
            db.update(
                "update index_task set status=case when attempts>=3 then 'FAILED' else 'RETRY'"
                    + " end,error=?,available_at=now()+interval '3 seconds' where id=?",
                error,
                id);
            db.update("update document_version set status='FAILED' where id=?", version);
            db.update(
                "update document set status=case when exists(select 1 from index_task where id=?"
                    + " and status='FAILED') then 'FAILED' else 'PENDING' end,error=? where id=?",
                id,
                error,
                doc);
          });
    }
    return true;
  }

  private String safeError(Exception e) {
    if (e instanceof IllegalArgumentException
        || e instanceof java.nio.charset.CharacterCodingException)
      return "文档处理失败："
          + (e.getMessage() == null
              ? "请检查 UTF-8 文本格式"
              : e.getMessage().substring(0, Math.min(250, e.getMessage().length())));
    return "索引失败（" + e.getClass().getSimpleName() + "），请检查模型连接及文档格式";
  }
}
