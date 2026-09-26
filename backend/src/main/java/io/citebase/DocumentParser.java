package io.citebase;

import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Component;

@Component
public class DocumentParser {
  public record Part(int page, int paragraph, int startOffset, int endOffset, String text) {}

  public List<Part> parse(byte[] source, String type) throws Exception {
    List<Part> result = new ArrayList<>();
    if (type.equals("pdf")) {
      try (var pdf = Loader.loadPDF(source)) {
        if (pdf.isEncrypted()) throw new IllegalArgumentException("不支持加密 PDF");
        if (pdf.getNumberOfPages() > 500) throw new IllegalArgumentException("PDF 不得超过 500 页");
        PDFTextStripper stripper = new PDFTextStripper();
        for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
          stripper.setStartPage(page);
          stripper.setEndPage(page);
          split(result, page, stripper.getText(pdf));
        }
      }
    } else {
      String text =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(source))
              .toString();
      split(result, 1, text);
    }
    if (result.isEmpty()) throw new IllegalArgumentException("未找到文本；扫描 PDF 请先自行 OCR");
    if (result.size() > 5000) throw new IllegalArgumentException("文档分块过多（最多 5000 块）");
    return result;
  }

  private void split(List<Part> result, int page, String raw) {
    String text = raw.replace("\r\n", "\n").replace('\r', '\n');
    var matcher =
        java.util.regex.Pattern.compile("\\S[\\s\\S]*?(?=\\n[\\t ]*\\n|\\z)").matcher(text);
    int paragraph = 0;
    while (matcher.find()) {
      String block = matcher.group().stripTrailing();
      paragraph++;
      for (int start = 0; start < block.length(); start += 700) {
        int end = Math.min(block.length(), start + 900);
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
}
