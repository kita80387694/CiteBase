package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class DocumentParserTest {
  @Test
  void preservesParagraphOffsetsAndSplitsLongContent() throws Exception {
    String text = "# 标题\n\n事实一。\n\n" + "甲".repeat(1100);
    var parts = new DocumentParser().parse(text.getBytes(StandardCharsets.UTF_8), "md");
    assertEquals(4, parts.size());
    assertEquals(2, parts.get(1).paragraph());
    assertEquals("事实一。", parts.get(1).text());
    for (var p : parts) assertEquals(p.text(), text.substring(p.startOffset(), p.endOffset()));
    assertEquals(parts.get(2).paragraph(), parts.get(3).paragraph());
  }

  @Test
  void rejectsEmptyAndMalformedText() {
    assertThrows(
        IllegalArgumentException.class, () -> new DocumentParser().parse(" \n".getBytes(), "txt"));
    assertThrows(
        java.nio.charset.CharacterCodingException.class,
        () -> new DocumentParser().parse(new byte[] {(byte) 0xff}, "txt"));
  }

  @Test
  void pdfPreservesPagesAndRejectsScannedPages() throws Exception {
    try (var pdf = new org.apache.pdfbox.pdmodel.PDDocument()) {
      for (int i = 1; i <= 2; i++) {
        var page = new org.apache.pdfbox.pdmodel.PDPage();
        pdf.addPage(page);
        try (var stream = new org.apache.pdfbox.pdmodel.PDPageContentStream(pdf, page)) {
          stream.beginText();
          stream.setFont(
              new org.apache.pdfbox.pdmodel.font.PDType1Font(
                  org.apache.pdfbox.pdmodel.font.Standard14Fonts.FontName.HELVETICA),
              12);
          stream.newLineAtOffset(30, 700);
          stream.showText("Page " + i + " evidence");
          stream.endText();
        }
      }
      var bytes = new java.io.ByteArrayOutputStream();
      pdf.save(bytes);
      var parts = new DocumentParser().parse(bytes.toByteArray(), "pdf");
      assertEquals(2, parts.size());
      assertEquals(2, parts.get(1).page());
      assertTrue(parts.get(1).text().contains("Page 2"));
    }
    try (var pdf = new org.apache.pdfbox.pdmodel.PDDocument()) {
      pdf.addPage(new org.apache.pdfbox.pdmodel.PDPage());
      var bytes = new java.io.ByteArrayOutputStream();
      pdf.save(bytes);
      assertThrows(
          IllegalArgumentException.class,
          () -> new DocumentParser().parse(bytes.toByteArray(), "pdf"));
    }
  }
}
