package io.citebase;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AccessService {
  private final JdbcTemplate db;

  public AccessService(JdbcTemplate db) {
    this.db = db;
  }

  public void requireKnowledgeBase(String userId, String kbId) {
    if (db.queryForObject(
            "select count(*) from knowledge_base where id=? and user_id=?",
            Integer.class,
            kbId,
            userId)
        != 1) throw missing();
  }

  public void requireDocument(String userId, String id) {
    if (db.queryForObject(
            "select count(*) from document d join knowledge_base k on k.id=d.kb_id where d.id=? and"
                + " k.user_id=?",
            Integer.class,
            id,
            userId)
        != 1) throw missing();
  }

  public static ResponseStatusException missing() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "记录不存在");
  }
}
