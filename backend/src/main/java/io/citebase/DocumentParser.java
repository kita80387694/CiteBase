package io.citebase;

import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Component;

@Component
public class DocumentParser {
  public record Part(
      int page, int paragraph, int startOffset, int endOffset, String text, String headingPath) {
    public Part(int page, int paragraph, int startOffset, int endOffset, String text) {
      this(page, paragraph, startOffset, endOffset, text, "");
    }
  }

  public List<Part> parse(byte[] source, String type) throws Exception {
    return parse(source, type, ChunkProfile.defaults());
  }

  public List<Part> parse(byte[] source, String type, ChunkProfile profile) throws Exception {
    List<Part> result = new ArrayList<>();
    if (type.equals("pdf")) {
      try (var pdf = Loader.loadPDF(source)) {
        if (pdf.isEncrypted()) throw new IllegalArgumentException("不支持加密 PDF");
        if (pdf.getNumberOfPages() > 500) throw new IllegalArgumentException("PDF 不得超过 500 页");
        PDFTextStripper stripper = new PDFTextStripper();
        for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
          stripper.setStartPage(page);
          stripper.setEndPage(page);
          split(result, page, stripper.getText(pdf), profile);
        }
      }
    } else {
      String text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(source))
              .toString();
      split(result, 1, text, profile);
    }
    if (result.isEmpty()) throw new IllegalArgumentException("未找到文本；扫描 PDF 请先自行 OCR");
    if (result.size() > 5000) throw new IllegalArgumentException("文档分块过多（最多 5000 块）");
    return result;
  }

  private void split(List<Part> result, int page, String raw, ChunkProfile profile) {
    String text = raw.replace("\r\n", "\n").replace('\r', '\n');
    if (profile.strategy().equals("structure-v1")) {
      structured(result, page, text, profile);
      return;
    }
    var matcher =
        java.util.regex.Pattern.compile("\\S[\\s\\S]*?(?=\\n[\\t ]*\\n|\\z)").matcher(text);
    int paragraph = 0;
    while (matcher.find()) {
      String block = matcher.group().stripTrailing();
      paragraph++;
      for (int start = 0; start < block.length(); start += profile.size() - profile.overlap()) {
        int end = Math.min(block.length(), start + profile.size());
        result.add(
            new Part(
                page,
                paragraph,
                matcher.start() + start,
                matcher.start() + end,
                block.substring(start, end)));
        if (end == block.length()) break;
      }
    }
  }

  private record Unit(
      int start, int end, int paragraph, String path, boolean heading, boolean row) {}

  /** Preserve source spans: metadata gives context, content is always an exact page substring. */
  private void structured(List<Part> out, int page, String text, ChunkProfile profile) {
    List<Unit> units = new ArrayList<>();
    var paragraphs =
        java.util.regex.Pattern.compile("\\S[\\s\\S]*?(?=\\n[\\t ]*\\n|\\z)").matcher(text);
    var headings = new TreeMap<Integer, String>();
    int paragraph = 0;
    while (paragraphs.find()) {
      paragraph++;
      int base = paragraphs.start();
      String block = paragraphs.group().stripTrailing();
      var lines = java.util.regex.Pattern.compile("[^\\n]+(?:\\n|$)").matcher(block);
      int proseStart = -1, proseEnd = -1;
      while (lines.find()) {
        int start = base + lines.start(),
            end = base + lines.start() + lines.group().stripTrailing().length();
        String line = text.substring(start, end);
        var heading = java.util.regex.Pattern.compile("^ {0,3}(#{1,6})[ \\t]+(.+)$").matcher(line);
        boolean isHeading = heading.matches();
        boolean row = line.stripLeading().startsWith("|") && line.strip().endsWith("|");
        if (isHeading || row) {
          if (proseStart >= 0)
            units.add(
                new Unit(
                    proseStart,
                    proseEnd,
                    paragraph,
                    String.join("\n", headings.values()),
                    false,
                    false));
          proseStart = -1;
          if (isHeading) {
            int level = heading.group(1).length();
            headings.tailMap(level).clear();
            headings.put(level, line.strip());
          }
          units.add(
              new Unit(
                  start, end, paragraph, String.join("\n", headings.values()), isHeading, row));
        } else if (!line.isBlank()) {
          if (proseStart < 0) proseStart = start;
          proseEnd = end;
        }
      }
      if (proseStart >= 0)
        units.add(
            new Unit(
                proseStart,
                proseEnd,
                paragraph,
                String.join("\n", headings.values()),
                false,
                false));
    }
    List<Unit> buffer = new ArrayList<>();
    for (Unit unit : units) {
      if (!buffer.isEmpty() && (unit.heading() || !buffer.getFirst().path().equals(unit.path()))) {
        emit(out, page, text, buffer);
        buffer.clear();
      }
      if (unit.end() - unit.start() > profile.size()) {
        if (!buffer.isEmpty()) {
          emit(out, page, text, buffer);
          buffer.clear();
        }
        if (unit.row()) {
          if (unit.end() - unit.start() > 8000)
            throw new IllegalArgumentException("表格单行超过8000字符，请先拆分该行");
          emit(out, page, text, List.of(unit));
        } else {
          int start = unit.start();
          while (start < unit.end()) {
            int end = Math.min(start + profile.size(), unit.end());
            if (end < unit.end()
                && Character.isHighSurrogate(text.charAt(end - 1))
                && Character.isLowSurrogate(text.charAt(end))) end--;
            out.add(
                new Part(
                    page, unit.paragraph(), start, end, text.substring(start, end), unit.path()));
            if (end == unit.end()) break;
            int next = end - profile.overlap();
            if (next > start
                && Character.isLowSurrogate(text.charAt(next))
                && Character.isHighSurrogate(text.charAt(next - 1))) next++;
            start = next;
          }
        }
        continue;
      }
      if (!buffer.isEmpty() && unit.end() - buffer.getFirst().start() > profile.size()) {
        emit(out, page, text, buffer);
        int priorEnd = buffer.getLast().end();
        while (!buffer.isEmpty()
            && (priorEnd - buffer.getFirst().start() > profile.overlap()
                || unit.end() - buffer.getFirst().start() > profile.size())) buffer.removeFirst();
      }
      buffer.add(unit);
    }
    if (!buffer.isEmpty()) emit(out, page, text, buffer);
  }

  private void emit(List<Part> out, int page, String text, List<Unit> units) {
    Unit first = units.getFirst(), last = units.getLast();
    out.add(
        new Part(
            page,
            first.paragraph(),
            first.start(),
            last.end(),
            text.substring(first.start(), last.end()),
            first.path()));
  }
}
