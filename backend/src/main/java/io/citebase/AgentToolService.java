package io.citebase;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AgentToolService {
  private final RetrievalService retrieval;
  private final JdbcTemplate db;

  public AgentToolService(RetrievalService retrieval, JdbcTemplate db) {
    this.retrieval = retrieval;
    this.db = db;
  }

  public record ToolResult(List<Evidence> evidence, Object usage, String error) {}

  public ToolResult call(
      String user,
      AgentInput.Request request,
      String action,
      Map<String, Object> args,
      Map<String, Evidence> handles) {
    switch (action) {
      case "search":
        {
          exact(args, Set.of("query"));
          String query = text(args, "query", 4000);
          var r =
              retrieval.retrieveDetailed(
                  user,
                  request.kbId(),
                  query,
                  request.mode(),
                  request.topK(),
                  request.retrievalOptions());
          return new ToolResult(r.evidence(), r.usage(), r.error());
        }
      case "inspectCitation":
        {
          exact(args, Set.of("evidenceHandle"));
          var e = handle(args, handles);
          verify(user, request, e);
          var current = retrieval.citation(user, e.id());
          return new ToolResult(List.of(current), null, null);
        }
      case "neighbors":
        {
          exact(args, Set.of("evidenceHandle", "direction"));
          var e = handle(args, handles);
          String direction = text(args, "direction", 20);
          if (!Set.of("previous", "next").contains(direction))
            throw new AgentPolicy.Stop("INVALID_ACTION");
          verify(user, request, e);
          boolean next = direction.equals("next");
          String comparison = next ? ">" : "<", order = next ? "asc" : "desc";
          var found =
              db.query(
                  "select"
                      + " c.id,c.document_id,d.name,c.version_id,c.page,c.paragraph,c.start_offset,c.end_offset,c.content"
                      + " from chunk c join document d on d.id=c.document_id and"
                      + " d.active_version_id=c.version_id join knowledge_base k on k.id=d.kb_id"
                      + " where k.user_id=? and k.id=? and c.document_id=? and c.version_id=? and"
                      + " (c.page,c.start_offset,c.id) "
                      + comparison
                      + " (?,?,?) order by c.page "
                      + order
                      + ",c.start_offset "
                      + order
                      + ",c.id "
                      + order
                      + " limit 1",
                  (rs, n) ->
                      new Evidence(
                          rs.getString(1),
                          rs.getString(2),
                          rs.getString(3),
                          rs.getString(4),
                          rs.getInt(5),
                          rs.getInt(6),
                          rs.getInt(7),
                          rs.getInt(8),
                          rs.getString(9),
                          0),
                  user,
                  request.kbId(),
                  e.documentId(),
                  e.versionId(),
                  e.page(),
                  e.startOffset(),
                  e.id());
          return new ToolResult(found, null, null);
        }
      default:
        throw new AgentPolicy.Stop("INVALID_ACTION");
    }
  }

  public void verify(String user, AgentInput.Request request, Evidence e) {
    Integer count =
        db.queryForObject(
            "select count(*) from chunk c join document d on d.id=c.document_id and"
                + " d.active_version_id=c.version_id join knowledge_base k on k.id=d.kb_id where"
                + " k.user_id=? and k.id=? and c.id=? and c.document_id=? and c.version_id=? and"
                + " d.name=? and c.page=? and c.paragraph=? and c.start_offset=? and c.end_offset=?"
                + " and c.content=?",
            Integer.class,
            user,
            request.kbId(),
            e.id(),
            e.documentId(),
            e.versionId(),
            e.documentName(),
            e.page(),
            e.paragraph(),
            e.startOffset(),
            e.endOffset(),
            e.text());
    if (count == null || count != 1) throw new AgentPolicy.Stop("INVALID_EVIDENCE");
  }

  static void exact(Map<String, Object> args, Set<String> fields) {
    if (args == null || !args.keySet().equals(fields)) throw new AgentPolicy.Stop("INVALID_ACTION");
  }

  static String text(Map<String, Object> args, String name, int max) {
    if (!(args.get(name) instanceof String s)
        || s.isBlank()
        || s.length() > max
        || s.indexOf('\0') >= 0) throw new AgentPolicy.Stop("INVALID_ACTION");
    return (String) args.get(name);
  }

  private Evidence handle(Map<String, Object> args, Map<String, Evidence> handles) {
    var e = handles.get(text(args, "evidenceHandle", 20));
    if (e == null) throw new AgentPolicy.Stop("INVALID_ACTION");
    return e;
  }
}
