import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import io.citebase.DocumentParser;
// Deliberately invokes production DocumentParser, not another copy of its chunking algorithm.
class Phase2ParserCheck {
  public static void main(String[] args) throws Exception {
    var parser = new DocumentParser();
    for (String path : args) {
      String name = Path.of(path).getFileName().toString();
      var parts = parser.parse(Files.readAllBytes(Path.of(path)), name.endsWith(".pdf") ? "pdf" : "markdown");
      for (var p : parts) System.out.println(name + "\t" + p.page() + "\t" + p.paragraph() + "\t" + p.startOffset() + "\t" + p.endOffset() + "\t" + Base64.getEncoder().encodeToString(p.text().getBytes(StandardCharsets.UTF_8)));
    }
  }
}
