package io.citebase;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;

class StructureChunkingTest {
  @Test
  void preservesHierarchySourceAndCrossParagraphLabels() throws Exception {
    String source =
        "# Root\r\n\r\n"
            + "alpha evidence\r\n\r\n"
            + "## Child\r\n\r\n"
            + "beta evidence\r\n\r\n"
            + "## Sibling\r\n\r\n"
            + "gamma evidence";
    String normalized = source.replace("\r\n", "\n");
    var parts =
        new DocumentParser()
            .parse(
                source.getBytes(StandardCharsets.UTF_8),
                "md",
                ChunkProfile.of("structure-v1", 900, 200));
    assertEquals(3, parts.size());
    assertEquals("# Root\n## Child", parts.get(1).headingPath());
    assertEquals("# Root\n## Sibling", parts.get(2).headingPath());
    for (var p : parts)
      assertEquals(normalized.substring(p.startOffset(), p.endOffset()), p.text());
    var p = parts.getFirst();
    int start = normalized.indexOf("alpha evidence");
    var e =
        new Evidence(
            "c", "d", "doc.md", "v", 1, p.paragraph(), p.startOffset(), p.endOffset(), p.text(), 1);
    var exact =
        new EvaluationMetrics.Label(
            "doc.md", 1, 2, "alpha evidence", "hash", start, start + 14, "g");
    assertTrue(EvaluationMetrics.matches(exact, e, Map.of("v", "hash")));
    assertFalse(EvaluationMetrics.matches(exact, e, Map.of("v", "wrong")));
    assertFalse(
        EvaluationMetrics.matches(
            new EvaluationMetrics.Label("doc.md", 1, 2, "alpha evidence"), e));
  }

  @Test
  void preservesWholeTableRowsAndBoundedWholeUnitOverlap() throws Exception {
    String row = "| key | " + "值".repeat(240) + " |";
    String source =
        "# Table\n\n| name | value |\n| --- | --- |\n"
            + row
            + "\n| final | evidence |\n\n"
            + "甲".repeat(130)
            + "\n\n"
            + "乙".repeat(60)
            + "\n\n"
            + "丙".repeat(130);
    var parts =
        new DocumentParser()
            .parse(
                source.getBytes(StandardCharsets.UTF_8),
                "md",
                ChunkProfile.of("structure-v1", 200, 80));
    assertTrue(parts.stream().anyMatch(p -> p.text().equals(row)));
    assertEquals(1, parts.stream().filter(p -> p.text().contains(row)).count());
    for (var p : parts) assertEquals(source.substring(p.startOffset(), p.endOffset()), p.text());
    assertTrue(
        parts.stream()
            .anyMatch(
                p -> p.text().contains("乙".repeat(60)) && p.text().contains("丙".repeat(130))));
  }

  @Test
  void longProseDoesNotSplitSurrogatePairsAndLegacyRemainsUnchanged() throws Exception {
    String source = "a" + "😀".repeat(300);
    var parser = new DocumentParser();
    for (var p :
        parser.parse(
            source.getBytes(StandardCharsets.UTF_8),
            "txt",
            ChunkProfile.of("structure-v1", 200, 50))) {
      assertFalse(Character.isLowSurrogate(p.text().charAt(0)));
      assertFalse(Character.isHighSurrogate(p.text().charAt(p.text().length() - 1)));
      assertEquals(source.substring(p.startOffset(), p.endOffset()), p.text());
    }
    byte[] bytes = ("# Title\n\n" + "a".repeat(1100)).getBytes(StandardCharsets.UTF_8);
    assertEquals(parser.parse(bytes, "md"), parser.parse(bytes, "md", ChunkProfile.defaults()));
    assertThrows(IllegalArgumentException.class, () -> ChunkProfile.of("unknown", 900, 200));
    assertThrows(IllegalArgumentException.class, () -> ChunkProfile.of("legacy", 200, 200));
  }
}
