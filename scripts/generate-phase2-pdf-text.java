import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
// Uses the same PDFBox extraction and normalization as DocumentParser; no OCR or Python service.
class Phase2PdfText {
  public static void main(String[] args) throws Exception {
    for (String path : args) try (var pdf = Loader.loadPDF(Path.of(path).toFile())) {
      var stripper = new PDFTextStripper();
      for (int page = 1; page <= pdf.getNumberOfPages(); page++) {
        stripper.setStartPage(page); stripper.setEndPage(page);
        String text = stripper.getText(pdf).replace("\r\n", "\n").replace('\r', '\n');
        System.out.println(Path.of(path).getFileName() + "\t" + page + "\t" + Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)));
      }
    }
  }
}
