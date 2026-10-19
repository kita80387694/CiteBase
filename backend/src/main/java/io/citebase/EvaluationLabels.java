package io.citebase;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Resolves annotations against authorized ACTIVE SOURCE, never against retrieved candidates. */
@Component
public class EvaluationLabels {
  private final JdbcTemplate db;
  private final DocumentParser parser;

  public EvaluationLabels(JdbcTemplate db, DocumentParser parser) {
    this.db = db;
    this.parser = parser;
  }

  record Source(String name, String hash, List<Paragraph> paragraphs) {}

  record Paragraph(int page, int number, int start, String text) {}

  public EvaluationService.Dataset resolve(
      String user, String kb, EvaluationService.Dataset dataset) {
    if (dataset == null
        || dataset.version() == null
        || dataset.version().isBlank()
        || dataset.version().length() > 200
        || dataset.questions() == null
        || dataset.questions().isEmpty()
        || dataset.questions().size() > 200) bad();
    return resolve(dataset, capture(user, kb));
  }

  List<Source> capture(String user, String kb) {
    return db.query(
        "SELECT d.name,v.content_hash,v.source,v.media_type FROM document d JOIN"
            + " document_version v ON v.id=d.active_version_id JOIN knowledge_base k ON"
            + " k.id=d.kb_id WHERE k.user_id=? AND k.id=?",
        (rs, n) -> {
          try {
            return new Source(
                rs.getString(1),
                rs.getString(2),
                reconstruct(parser.parse(rs.getBytes(3), rs.getString(4))));
          } catch (Exception e) {
            throw new IllegalArgumentException("无法解析活动原文标签", e);
          }
        },
        user,
        kb);
  }

  EvaluationService.Dataset resolve(EvaluationService.Dataset dataset, List<Source> sources) {
    var ids = new HashSet<String>();
    var cases = new ArrayList<EvaluationService.Case>();
    for (var c : dataset.questions()) {
      if (c == null
          || c.id() == null
          || c.id().isBlank()
          || c.id().length() > 100
          || !ids.add(c.id())
          || c.question() == null
          || c.question().isBlank()
          || c.question().length() > 4000
          || c.evidence() == null
          || c.evidence().size() > 100
          || c.answerable() == c.evidence().isEmpty()) bad();
      for (String value :
          Arrays.asList(c.category(), c.split(), c.group(), c.topic(), dataset.split()))
        if (value != null && (value.isBlank() || value.length() > 120)) bad();
      var labels = new ArrayList<EvaluationMetrics.Label>();
      var unique = new HashSet<EvaluationMetrics.Label>();
      for (var label : c.evidence()) {
        var resolved = resolve(label, sources);
        if (!unique.add(resolved)) throw new IllegalArgumentException("重复证据标签");
        labels.add(resolved);
      }
      cases.add(
          new EvaluationService.Case(
              c.id(),
              c.question(),
              c.answerable(),
              c.expectedAnswer(),
              labels,
              c.category(),
              c.split() == null ? dataset.split() : c.split(),
              c.group(),
              c.topic()));
    }
    return new EvaluationService.Dataset(dataset.version(), cases, dataset.seed(), dataset.split());
  }

  private EvaluationMetrics.Label resolve(EvaluationMetrics.Label l, List<Source> sources) {
    if (l == null
        || l.documentName() == null
        || l.documentName().isBlank()
        || l.quote() == null
        || l.quote().isBlank()
        || l.quote().length() > 16000
        || l.page() != null && l.page() < 1
        || l.paragraph() != null && l.paragraph() < 1
        || l.sourceHash() != null && !l.sourceHash().matches("[0-9a-f]{64}")
        || l.groupId() != null && (l.groupId().isBlank() || l.groupId().length() > 120)) bad();
    if ((l.startOffset() == null) != (l.endOffset() == null)
        || l.startOffset() != null
            && (l.page() == null
                || l.startOffset() < 0
                || l.endOffset() <= l.startOffset()
                || l.endOffset() - l.startOffset() != l.quote().length())) bad();
    var candidates =
        sources.stream()
            .filter(
                s ->
                    s.name().equals(l.documentName())
                        && (l.sourceHash() == null || s.hash().equals(l.sourceHash())))
            .toList();
    if (candidates.size() != 1) throw new IllegalArgumentException("证据文档不存在、版本不符或名称歧义");
    Source source = candidates.getFirst();
    var hits = new ArrayList<EvaluationMetrics.Label>();
    for (var p : source.paragraphs()) {
      if (l.page() != null && l.page() != p.page()
          || l.paragraph() != null && l.paragraph() != p.number()) continue;
      int offset = p.text().indexOf(l.quote());
      while (offset >= 0) {
        int start = p.start() + offset, end = start + l.quote().length();
        if (l.startOffset() == null || l.startOffset() == start && l.endOffset() == end)
          hits.add(
              new EvaluationMetrics.Label(
                  l.documentName(),
                  p.page(),
                  p.number(),
                  l.quote(),
                  source.hash(),
                  start,
                  end,
                  l.groupId()));
        offset = p.text().indexOf(l.quote(), offset + 1);
      }
    }
    if (hits.size() != 1) throw new IllegalArgumentException("标签原文位置不存在或不唯一");
    return hits.getFirst();
  }

  static List<Paragraph> reconstruct(List<DocumentParser.Part> parts) {
    var result = new ArrayList<Paragraph>();
    int page = -1, number = -1, start = 0;
    StringBuilder text = null;
    for (var part : parts) {
      if (part.page() != page || part.paragraph() != number) {
        if (text != null) result.add(new Paragraph(page, number, start, text.toString()));
        page = part.page();
        number = part.paragraph();
        start = part.startOffset();
        text = new StringBuilder();
      }
      int local = part.startOffset() - start;
      if (local > text.length()) throw new IllegalArgumentException("原文位置不连续");
      int overlap = Math.min(part.text().length(), text.length() - local);
      if (!text.substring(local, local + overlap).equals(part.text().substring(0, overlap)))
        throw new IllegalArgumentException("原文位置冲突");
      text.append(part.text().substring(overlap));
    }
    if (text != null) result.add(new Paragraph(page, number, start, text.toString()));
    return result;
  }

  private static void bad() {
    throw new IllegalArgumentException("评测标签字段无效");
  }
}
