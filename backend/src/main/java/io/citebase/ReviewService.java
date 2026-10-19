package io.citebase;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@SuppressWarnings("unchecked")
public class ReviewService {
  private final JdbcTemplate db;
  private final QuestionService json;

  public ReviewService(JdbcTemplate db, QuestionService json) {
    this.db = db;
    this.json = json;
  }

  private static void fields(Map<String, Object> b, String... keys) {
    if (!Set.of(keys).containsAll(b.keySet())) throw bad("非法字段");
  }

  private static long integer(Map<String, Object> b, String key, long fallback) {
    Object x = b.getOrDefault(key, fallback);
    if (!(x instanceof Number n) || n.doubleValue() != n.longValue()) throw bad("整数参数无效");
    return n.longValue();
  }

  private static String id() {
    return UUID.randomUUID().toString();
  }

  private static ResponseStatusException bad(String m) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, m);
  }

  private static String text(Map<String, Object> b, String k) {
    Object v = b.get(k);
    if (!(v instanceof String s) || s.isBlank() || s.length() > 4000) throw bad("字段无效: " + k);
    return s;
  }

  private Map<String, Object> decode(Object v) {
    return (Map<String, Object>) json.decode(v.toString());
  }

  static Object canonical(Object v) {
    if (v instanceof Map<?, ?> m) {
      var result = new TreeMap<String, Object>();
      m.forEach((k, x) -> result.put(k.toString(), canonical(x)));
      return result;
    }
    if (v instanceof List<?> list) return list.stream().map(ReviewService::canonical).toList();
    return v;
  }

  private String digest(Object v) {
    return AuthService.hash(json.encode(canonical(v)).getBytes(StandardCharsets.UTF_8));
  }

  private Map<String, Object> own(String u, String p) {
    return db
        .queryForList(
            "SELECT id,name,rule_version,created_at FROM review_project WHERE id=? AND owner_id=?",
            p,
            u)
        .stream()
        .findFirst()
        .orElseThrow(AccessService::missing);
  }

  public List<Map<String, Object>> projects(String u) {
    return db.query(
        "SELECT id,name,rule_version,created_at FROM review_project WHERE owner_id=? ORDER BY"
            + " created_at DESC",
        (r, n) ->
            Map.of(
                "id",
                r.getString(1),
                "name",
                r.getString(2),
                "ruleVersion",
                r.getString(3),
                "createdAt",
                r.getTimestamp(4).toInstant().toString()),
        u);
  }

  private List<Map<String, Object>> dependencies(String u, String kb) {
    return db.queryForList(
        "SELECT d.id,d.active_version_id FROM document d JOIN knowledge_base k ON k.id=d.kb_id"
            + " WHERE k.id=? AND k.user_id=? ORDER BY d.id",
        kb,
        u);
  }

  private Map<String, Object> source(String u, Map<String, Object> s) {
    String kind = text(s, "kind"), run = text(s, "runId");
    if (kind.equals("AGENT")) {
      var rows =
          db.queryForList(
              "SELECT kb_id,status,request::text,result::text,config::text FROM agent_run WHERE"
                  + " id=? AND user_id=?",
              run,
              u);
      if (rows.isEmpty()) throw AccessService.missing();
      var r = rows.getFirst();
      if (Set.of("CREATED", "RUNNING", "CANCEL_REQUESTED").contains(r.get("status")))
        throw bad("来源尚未结束");
      var result =
          r.get("result") == null ? new LinkedHashMap<String, Object>() : decode(r.get("result"));
      result.putIfAbsent(
          "modelMode", decode(r.get("config")).getOrDefault("modelMode", "unavailable"));
      result.putIfAbsent("question", decode(r.get("request")).get("question"));
      result.putIfAbsent("answer", "");
      result.put("executionFailed", !"COMPLETED".equals(r.get("status")));
      return Map.of("kb", r.get("kb_id"), "row", result);
    }
    if (!kind.equals("EVALUATION")) throw bad("来源类型无效");
    var rows =
        db.queryForList(
            "SELECT kb_id,status,payload::text,task_id FROM evaluation_run WHERE id=? AND"
                + " user_id=?",
            run,
            u);
    if (rows.isEmpty()) throw AccessService.missing();
    var r = rows.getFirst();
    if (Set.of("QUEUED", "RUNNING", "RETRY_WAIT", "CANCEL_REQUESTED").contains(r.get("status")))
      throw bad("来源尚未结束");
    List<Map<String, Object>> results;
    if (r.get("task_id") != null)
      results =
          db.query(
              "SELECT result::text FROM evaluation_item WHERE evaluation_id=? AND case_id=? AND"
                  + " mode=? AND result IS NOT NULL",
              (rs, n) -> decode(rs.getString(1)),
              run,
              s.get("caseId"),
              s.get("mode"));
    else
      results =
          (List<Map<String, Object>>) decode(r.get("payload")).getOrDefault("results", List.of());
    var row =
        results.stream()
            .filter(
                x ->
                    Objects.equals(x.get("caseId"), s.get("caseId"))
                        && Objects.equals(x.get("mode"), s.get("mode")))
            .findFirst()
            .orElseThrow(() -> bad("来源题目不存在"));
    return Map.of("kb", r.get("kb_id"), "row", row);
  }

  private List<Map<String, Object>> expand(String u, Map<String, Object> s) {
    if (!"EVALUATION".equals(s.get("kind")) || s.containsKey("caseId")) return List.of(s);
    String run = text(s, "runId");
    var rows =
        db.queryForList(
            "SELECT payload::text,task_id FROM evaluation_run WHERE id=? AND user_id=?", run, u);
    if (rows.isEmpty()) throw AccessService.missing();
    List<Map<String, Object>> results =
        rows.getFirst().get("task_id") == null
            ? (List<Map<String, Object>>)
                decode(rows.getFirst().get("payload")).getOrDefault("results", List.of())
            : db.query(
                "SELECT result::text FROM evaluation_item WHERE evaluation_id=? AND result IS NOT"
                    + " NULL ORDER BY ordinal",
                (r, n) -> decode(r.getString(1)),
                run);
    return results.stream()
        .map(
            x ->
                Map.<String, Object>of(
                    "kind",
                    "EVALUATION",
                    "runId",
                    run,
                    "caseId",
                    x.get("caseId"),
                    "mode",
                    x.get("mode")))
        .toList();
  }

  @Transactional
  public Object create(String u, Map<String, Object> b) {
    if (!Set.of("name", "ruleVersion", "sources").containsAll(b.keySet())) throw bad("非法字段");
    String name = text(b, "name"), rule = text(b, "ruleVersion"), p = id();
    if (!(b.get("sources") instanceof List<?> sources) || sources.isEmpty() || sources.size() > 500)
      throw bad("来源数量无效");
    db.update(
        "INSERT INTO review_project(id,owner_id,name,rule_version) VALUES(?,?,?,?)",
        p,
        u,
        name,
        rule);
    Set<String> seen = new HashSet<>();
    int count = 0;
    for (Object v : sources) {
      if (!(v instanceof Map)) throw bad("来源无效");
      var input = (Map<String, Object>) v;
      fields(input, "kind", "runId", "caseId", "mode");
      String sourceKind = text(input, "kind");
      if ("AGENT".equals(sourceKind)) fields(input, "kind", "runId");
      else if (!"EVALUATION".equals(sourceKind)) throw bad("来源类型无效");
      if (input.containsKey("caseId") != input.containsKey("mode")) throw bad("caseId与mode必须同时指定");
      for (var s : expand(u, input)) {
        if (!Set.of("kind", "runId", "caseId", "mode").containsAll(s.keySet())
            || !seen.add(digest(s))) throw bad("重复或非法来源");
        if (++count > 1000) throw bad("最多1000份回答");
        var src = source(u, s);
        String kb = src.get("kb").toString();
        db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
        src = source(u, s);
        var row = (Map<String, Object>) src.get("row");
        var deps = dependencies(u, kb);
        // All original evidence must still resolve to its exact stored source. No arbitrary answer
        // import.
        for (Object e : (List<?>) row.getOrDefault("evidence", List.of())) {
          var em = (Map<String, Object>) e;
          Integer n =
              db.queryForObject(
                  "SELECT count(*) FROM chunk c JOIN document d ON d.id=c.document_id JOIN"
                      + " knowledge_base k ON k.id=d.kb_id WHERE c.id=? AND c.version_id=? AND"
                      + " d.active_version_id=c.version_id AND k.id=? AND k.user_id=?",
                  Integer.class,
                  em.get("id"),
                  em.get("versionId"),
                  kb,
                  u);
          if (n == null || n != 1) throw bad("来源证据已撤回");
        }
        db.update(
            "INSERT INTO review_item(id,project_id,source,source_digest,packet,dependencies)"
                + " VALUES(?,?,?::jsonb,?,?::jsonb,?::jsonb)",
            id(),
            p,
            json.encode(s),
            digest(row),
            json.encode(referencePacket(u, kb, row)),
            json.encode(Map.of("kb", kb, "documents", deps)));
      }
    }
    if (count == 0) throw bad("没有可评审结果");
    return project(u, p);
  }

  private Map<String, Object> referencePacket(String user, String kb, Map<String, Object> row) {
    var packet = new LinkedHashMap<>(row);
    if (!packet.containsKey("expectedAnswer")) {
      var matches =
          db.queryForList(
              "SELECT i.result::text,r.id run_id,i.case_id,i.mode FROM evaluation_item i JOIN"
                  + " evaluation_run r ON r.id=i.evaluation_id WHERE r.user_id=? AND r.kb_id=? AND"
                  + " i.result->>'question'=? AND i.result IS NOT NULL ORDER BY r.created_at"
                  + " DESC,i.ordinal LIMIT 1",
              user,
              kb,
              row.get("question"));
      if (!matches.isEmpty()) {
        var match = matches.getFirst();
        var reference = decode(match.get("result"));
        for (String field : List.of("expectedAnswer", "expectedEvidence", "answerable"))
          packet.put(field, reference.get(field));
        packet.put(
            "_referenceSource",
            Map.of(
                "kind",
                "EVALUATION",
                "runId",
                match.get("run_id"),
                "caseId",
                match.get("case_id"),
                "mode",
                match.get("mode")));
        packet.put("_referenceDigest", digest(reference));
      }
    }
    for (Object x : packet.get("expectedEvidence") instanceof List<?> l ? l : List.of()) {
      var label = (Map<?, ?>) x;
      Integer count =
          db.queryForObject(
              "SELECT count(*) FROM document d JOIN document_version v ON v.id=d.active_version_id"
                  + " JOIN knowledge_base k ON k.id=d.kb_id WHERE k.id=? AND k.user_id=? AND"
                  + " d.name=? AND v.content_hash=?",
              Integer.class,
              kb,
              user,
              label.get("documentName"),
              label.get("sourceHash"));
      if (count == null || count != 1) throw bad("参考证据版本已撤回，不能创建评审包");
    }
    return packet;
  }

  private boolean available(String owner, Map<String, Object> i) {
    try {
      var deps = decode(i.get("dependencies"));
      String kb = deps.get("kb").toString();
      Integer n =
          db.queryForObject(
              "SELECT count(*) FROM knowledge_base WHERE id=? AND user_id=?",
              Integer.class,
              kb,
              owner);
      if (n == null || n != 1 || !Objects.equals(deps.get("documents"), dependencies(owner, kb)))
        return false;
      var packet = decode(i.get("packet"));
      if (packet.get("_referenceSource") instanceof Map<?, ?> reference) {
        if (!Objects.equals(
            packet.get("_referenceDigest"),
            digest(source(owner, (Map<String, Object>) reference).get("row")))) return false;
      } else if ("AGENT".equals(decode(i.get("source")).get("kind"))
          && packet.containsKey("answerable")) return false;
      return digest(source(owner, decode(i.get("source"))).get("row"))
          .equals(i.get("source_digest"));
    } catch (ResponseStatusException e) {
      return false;
    }
  }

  @Transactional
  public Object assign(String u, String p, Map<String, Object> b) {
    fields(b, "usernames", "secondReviewPercent", "seed");
    own(u, p);
    db.queryForList("SELECT id FROM review_project WHERE id=? FOR UPDATE", p);
    if (!(b.get("usernames") instanceof List<?> names)
        || names.isEmpty()
        || names.size() > 20
        || new HashSet<>(names).size() != names.size()) throw bad("评审者列表无效");
    long rawPercent = integer(b, "secondReviewPercent", 20);
    if (rawPercent < 0 || rawPercent > 100) throw bad("比例无效");
    int percent = (int) rawPercent;
    if (percent < 0 || percent > 100 || percent > 0 && names.size() < 2) throw bad("复核需要至少两位不同评审者");
    if (db.queryForObject(
            "SELECT count(*) FROM review_assignment a JOIN review_item i ON i.id=a.item_id WHERE"
                + " i.project_id=?",
            Integer.class,
            p)
        > 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "项目已分配，禁止重排已发生评审");
    List<String> users = new ArrayList<>();
    for (Object name : names) {
      if (!(name instanceof String nameText) || nameText.isBlank()) throw bad("用户名无效");
      var rows = db.queryForList("SELECT id FROM app_user WHERE username=?", name);
      if (rows.isEmpty()) throw bad("用户不存在");
      users.add(rows.getFirst().get("id").toString());
    }
    var items =
        new ArrayList<>(
            db.queryForList("SELECT id FROM review_item WHERE project_id=? ORDER BY id", p));
    Collections.shuffle(items, new Random(integer(b, "seed", 20260930)));
    int doubleCount = (int) Math.ceil(items.size() * percent / 100d);
    for (int j = 0; j < items.size(); j++) {
      for (int k = 0; k < (j < doubleCount ? 2 : 1); k++)
        db.update(
            "INSERT INTO review_assignment(id,item_id,reviewer_id,ordinal) VALUES(?,?,?,?)",
            id(),
            items.get(j).get("id"),
            users.get((j + k) % users.size()),
            j);
    }
    return project(u, p);
  }

  @Transactional
  public Object revoke(String u, String p, Map<String, Object> b) {
    fields(b, "username");
    own(u, p);
    // Match score/import lock order before touching assignment rows. project() below also reads
    // sources.
    lockProjectSources(p);
    var affected =
        db.queryForList(
            "SELECT DISTINCT i.* FROM review_item i JOIN review_assignment a ON a.item_id=i.id"
                + " JOIN app_user x ON x.id=a.reviewer_id WHERE i.project_id=? AND x.username=?",
            p,
            text(b, "username"));
    lockReviewItems(affected);
    db.update(
        "UPDATE review_assignment a SET revoked=true FROM review_item i,app_user x WHERE"
            + " a.item_id=i.id AND i.project_id=? AND x.id=a.reviewer_id AND x.username=?",
        p,
        text(b, "username"));
    return project(u, p);
  }

  private Map<String, Object> assigned(String u, String a) {
    var rows =
        db.queryForList(
            "SELECT a.id assignment_id,a.ordinal,a.revoked,i.*,p.owner_id,p.name,p.rule_version"
                + " FROM review_assignment a JOIN review_item i ON i.id=a.item_id JOIN"
                + " review_project p ON p.id=i.project_id WHERE a.id=? AND a.reviewer_id=? AND NOT"
                + " a.revoked",
            a,
            u);
    if (rows.isEmpty()) throw AccessService.missing();
    return rows.getFirst();
  }

  private void lockSource(Map<String, Object> r) {
    db.queryForList(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))",
        decode(r.get("dependencies")).get("kb"));
  }

  private void lockReviewItems(List<Map<String, Object>> items) {
    var bases = new TreeSet<String>();
    var ids = new TreeSet<String>();
    for (var item : items) {
      bases.add(decode(item.get("dependencies")).get("kb").toString());
      ids.add(item.get("id").toString());
    }
    for (String kb : bases)
      db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
    // Serializes score insertion and adjudication snapshots. Batch imports use the same global
    // order.
    for (String item : ids)
      db.queryForList("SELECT id FROM review_item WHERE id=? FOR UPDATE", item);
  }

  private void lockProjectSources(String project) {
    var bases = new TreeSet<String>();
    for (var item :
        db.queryForList("SELECT dependencies::text FROM review_item WHERE project_id=?", project))
      bases.add(decode(item.get("dependencies")).get("kb").toString());
    for (String kb : bases)
      db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
  }

  public Object assignments(String u) {
    var ids =
        db.queryForList(
            "SELECT id FROM review_assignment WHERE reviewer_id=? AND NOT revoked ORDER BY"
                + " ordinal,id",
            String.class,
            u);
    return ids.stream()
        .map(
            a -> {
              var r = assigned(u, a);
              return Map.of(
                  "id",
                  a,
                  "projectName",
                  r.get("name"),
                  "ruleVersion",
                  r.get("rule_version"),
                  "ordinal",
                  r.get("ordinal"),
                  "status",
                  available(r.get("owner_id").toString(), r) ? "AVAILABLE" : "WITHDRAWN",
                  "scored",
                  !scores(a).isEmpty());
            })
        .toList();
  }

  private List<Map<String, Object>> scores(String a) {
    return db.query(
        "SELECT id,payload::text,created_at FROM review_score WHERE assignment_id=? ORDER BY"
            + " sequence_id",
        (r, n) ->
            Map.of(
                "id",
                r.getString(1),
                "payload",
                decode(r.getString(2)),
                "createdAt",
                r.getTimestamp(3).toInstant().toString()),
        a);
  }

  @Transactional
  public Object assignment(String u, String a) {
    var r = assigned(u, a);
    lockSource(r);
    r = assigned(u, a);
    return blind(r, a, scores(a));
  }

  private Object blind(Map<String, Object> r, String a, List<Map<String, Object>> history) {
    var out = new LinkedHashMap<String, Object>();
    out.put("id", a);
    out.put("projectName", r.get("name"));
    out.put("ruleVersion", r.get("rule_version"));
    boolean active = available(r.get("owner_id").toString(), r);
    out.put("status", active ? "AVAILABLE" : "WITHDRAWN");
    if (!active) return out;
    var packet = decode(r.get("packet"));
    out.put("question", packet.getOrDefault("question", ""));
    out.put("answer", packet.getOrDefault("answer", ""));
    out.put(
        "executionFailed",
        Boolean.TRUE.equals(packet.get("executionFailed")) || packet.get("error") != null);
    List<Map<String, Object>> evidence = new ArrayList<>();
    List<String> citations = new ArrayList<>();
    Set<Object> cited = new HashSet<>();
    for (Object v : (List<?>) packet.getOrDefault("citations", List.of()))
      cited.add(((Map<?, ?>) v).get("id"));
    int n = 0;
    for (Object v : (List<?>) packet.getOrDefault("evidence", List.of())) {
      var e = (Map<String, Object>) v;
      String label = "" + (++n);
      var safe = new LinkedHashMap<String, Object>();
      safe.put("label", label);
      for (String key : List.of("documentName", "page", "paragraph", "text"))
        safe.put(key, e.get(key));
      evidence.add(safe);
      if (cited.contains(e.get("id"))) citations.add(label);
    }
    String answer = out.get("answer").toString();
    int labelIndex = 0;
    for (Object v : (List<?>) packet.getOrDefault("evidence", List.of())) {
      var e = (Map<String, Object>) v;
      answer = answer.replace("[" + e.get("id") + "]", "[" + (++labelIndex) + "]");
    }
    out.put("answer", answer);
    out.put("evidence", evidence);
    out.put("citations", citations);
    out.put("referenceAnswer", packet.get("expectedAnswer"));
    out.put("answerable", packet.get("answerable"));
    List<Map<String, Object>> expected = new ArrayList<>();
    Map<Object, String> groups = new LinkedHashMap<>();
    for (Object x :
        (packet.get("expectedEvidence") instanceof List<?> goldList ? goldList : List.of())) {
      var raw = (Map<String, Object>) x;
      var gold = new LinkedHashMap<String, Object>();
      for (String key : List.of("documentName", "page", "paragraph", "quote"))
        gold.put(key, raw.get(key));
      gold.put(
          "group",
          groups.computeIfAbsent(
              raw.get("groupId") == null
                  ? "item:" + expected.size()
                  : "group:" + raw.get("groupId"),
              k -> "G" + (groups.size() + 1)));
      expected.add(gold);
    }
    out.put("expectedEvidence", expected);
    out.put("history", history);
    out.put("latestScore", history.isEmpty() ? null : history.getLast());
    return out;
  }

  @Transactional
  public Object ownerItem(String u, String p, String item) {
    own(u, p);
    var rows =
        db.queryForList(
            "SELECT i.*,p.owner_id,p.name,p.rule_version FROM review_item i JOIN review_project p"
                + " ON p.id=i.project_id WHERE i.id=? AND p.id=?",
            item,
            p);
    if (rows.isEmpty()) throw AccessService.missing();
    lockSource(rows.getFirst());
    return blind(rows.getFirst(), item, List.of());
  }

  public static Map<String, Object> validateScore(Map<String, Object> b) {
    Map<String, Set<String>> fields =
        Map.of(
            "correctness",
            Set.of("CORRECT", "PARTIAL", "INCORRECT", "NA"),
            "completeness",
            Set.of("CORRECT", "PARTIAL", "INCORRECT", "NA"),
            "citationSupport",
            Set.of("SUPPORTED", "PARTIAL", "UNSUPPORTED", "NA"),
            "unsupportedContent",
            Set.of("NONE", "PRESENT", "NA"),
            "refusal",
            Set.of("CORRECT_REFUSAL", "INCORRECT_REFUSAL", "NOT_REFUSED", "NA"));
    var allowed = new HashSet<>(fields.keySet());
    allowed.add("rationale");
    if (!allowed.containsAll(b.keySet())) throw bad("非法评分字段");
    for (var e : fields.entrySet())
      if (b.get(e.getKey()) == null || !e.getValue().contains(b.get(e.getKey())))
        throw bad("评分维度缺失或无效");
    text(b, "rationale");
    return new LinkedHashMap<>(b);
  }

  @Transactional
  public Object score(String u, String a, Map<String, Object> b) {
    var valid = validateScore(b);
    var r = assigned(u, a);
    lockReviewItems(List.of(r));
    db.queryForList("SELECT id FROM review_assignment WHERE id=? FOR UPDATE", a);
    r = assigned(u, a);
    if (!available(r.get("owner_id").toString(), r))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "来源已撤回或变更");
    db.update(
        "INSERT INTO review_score(id,assignment_id,item_id,scored_by,kind,payload) VALUES(?,?,?,?,"
            + " 'HUMAN',?::jsonb)",
        id(),
        a,
        r.get("id"),
        u,
        json.encode(valid));
    return assignment(u, a);
  }

  @Transactional
  public Object importScores(String u, Map<String, Object> b) {
    fields(b, "scores");
    if (!(b.get("scores") instanceof List<?> rows) || rows.isEmpty() || rows.size() > 1000)
      throw bad("评分列表无效");
    var lockedItems = new ArrayList<Map<String, Object>>();
    for (Object v : rows) {
      if (!(v instanceof Map)) throw bad("评分无效");
      lockedItems.add(assigned(u, text((Map<String, Object>) v, "assignmentId")));
    }
    lockReviewItems(lockedItems);
    for (Object v : rows) {
      if (!(v instanceof Map)) throw bad("评分无效");
      var x = new LinkedHashMap<>((Map<String, Object>) v);
      String a = text(x, "assignmentId");
      x.remove("assignmentId");
      score(u, a, x);
    }
    return Map.of("imported", rows.size());
  }

  @Transactional
  public Object adjudicate(String u, String p, Map<String, Object> b) {
    own(u, p);
    var x = new LinkedHashMap<>(b);
    String item = text(x, "itemId");
    x.remove("itemId");
    var valid = validateScore(x);
    var rows = db.queryForList("SELECT * FROM review_item WHERE id=? AND project_id=?", item, p);
    if (rows.isEmpty()) throw AccessService.missing();
    lockProjectSources(p);
    lockReviewItems(rows);
    if (!available(u, rows.getFirst()))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "来源已撤回");
    var reviewed =
        db.queryForList(
            "SELECT DISTINCT ON (s.assignment_id) s.id,s.scored_by FROM review_score s"
                + " JOIN review_assignment a ON a.id=s.assignment_id"
                + " WHERE s.item_id=? AND s.kind='HUMAN' AND NOT a.revoked"
                + " ORDER BY s.assignment_id,s.sequence_id DESC",
            item);
    if (reviewed.stream().map(r -> r.get("scored_by")).distinct().count() < 2)
      throw bad("须先有两位有效真人评分");
    // Server-generated provenance: exact current score versions, never accepted from client input.
    valid.put("reviewedScoreIds", reviewed.stream().map(r -> r.get("id")).toList());
    db.update(
        "INSERT INTO review_score(id,item_id,scored_by,kind,payload)"
            + " VALUES(?,?,?,'ADJUDICATION',?::jsonb)",
        id(),
        item,
        u,
        json.encode(valid));
    return project(u, p);
  }

  @Transactional
  public Object project(String u, String p) {
    var base = own(u, p);
    var items = db.queryForList("SELECT * FROM review_item WHERE project_id=? ORDER BY id", p);
    var knowledgeBases = new TreeSet<String>();
    for (var item : items)
      knowledgeBases.add(decode(item.get("dependencies")).get("kb").toString());
    for (String kb : knowledgeBases)
      db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended(?,0))", kb);
    Set<Object> live = new HashSet<>();
    for (var item : items) if (available(u, item)) live.add(item.get("id"));
    var out = new LinkedHashMap<String, Object>();
    out.put("id", p);
    out.put("name", base.get("name"));
    out.put("ruleVersion", base.get("rule_version"));
    out.put(
        "items",
        items.stream()
            .map(
                i ->
                    Map.of(
                        "id",
                        i.get("id"),
                        "source",
                        decode(i.get("source")),
                        "status",
                        live.contains(i.get("id")) ? "AVAILABLE" : "WITHDRAWN",
                        "modelMode",
                        decode(i.get("packet")).getOrDefault("modelMode", "unavailable")))
            .toList());
    var assignments =
        db.query(
            "SELECT a.id,a.item_id,x.username,a.revoked,a.ordinal FROM review_assignment a JOIN"
                + " review_item i ON i.id=a.item_id JOIN app_user x ON x.id=a.reviewer_id WHERE"
                + " i.project_id=? ORDER BY a.ordinal",
            (r, n) ->
                Map.<String, Object>of(
                    "id",
                    r.getString(1),
                    "itemId",
                    r.getString(2),
                    "username",
                    r.getString(3),
                    "revoked",
                    r.getBoolean(4),
                    "ordinal",
                    r.getInt(5)),
            p);
    out.put("assignments", assignments);
    var scores =
        db.query(
            "SELECT s.* FROM review_score s JOIN review_item i ON i.id=s.item_id WHERE"
                + " i.project_id=? ORDER BY sequence_id",
            (r, n) -> {
              var v = new LinkedHashMap<String, Object>();
              v.put("id", r.getString("id"));
              v.put("itemId", r.getString("item_id"));
              v.put("assignmentId", r.getString("assignment_id"));
              v.put("scoredBy", r.getString("scored_by"));
              v.put("kind", r.getString("kind"));
              v.put("payload", decode(r.getString("payload")));
              v.put("createdAt", r.getTimestamp("created_at").toInstant().toString());
              return v;
            },
            p);

    for (var event : scores)
      if (!live.contains(event.get("itemId"))) event.put("payload", Map.of("withdrawn", true));
    out.put("scores", scores);
    Map<String, Map<String, Object>> latest = new HashMap<>();
    for (var s : scores)
      if ("HUMAN".equals(s.get("kind"))) latest.put(s.get("assignmentId").toString(), s);
    Map<Object, List<Map<String, Object>>> grouped = new HashMap<>();
    for (var s : latest.values())
      if (live.contains(s.get("itemId")))
        grouped.computeIfAbsent(s.get("itemId"), k -> new ArrayList<>()).add(s);
    int twice = 0, disputes = 0;
    for (var group : grouped.values())
      if (group.size() >= 2) {
        twice++;
        var dims = new HashSet<String>();
        for (var s : group) {
          var v = new LinkedHashMap<>((Map<String, Object>) s.get("payload"));
          v.remove("rationale");
          dims.add(json.encode(new TreeMap<>(v)));
        }
        if (dims.size() > 1) disputes++;
      }
    var stats = new LinkedHashMap<String, Object>();
    stats.put("items", items.size());
    stats.put("withdrawnItems", items.size() - live.size());
    stats.put(
        "activeScoredAssignments",
        latest.values().stream().filter(s -> live.contains(s.get("itemId"))).count());
    stats.put("assignments", assignments.size());
    stats.put("scoredAssignments", latest.size());
    stats.put("doubleReviewedItems", twice);
    stats.put("disputedItems", disputes);
    stats.put("agreement", twice == 0 ? null : (twice - disputes) / (double) twice);
    out.put("stats", stats);
    return out;
  }
}
