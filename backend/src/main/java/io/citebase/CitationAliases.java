package io.citebase;

import java.util.*;
import java.util.regex.Pattern;

/** Aliases change only source representation, never the allowed source set or refusal policy. */
public final class CitationAliases {
  public record Context(List<Evidence> promptEvidence, Map<String, String> aliases) {}

  public static Context prepare(List<Evidence> evidence, String style) {
    if (!"compact".equals(style)) return new Context(evidence, Map.of());
    var aliases = new LinkedHashMap<String, String>();
    var prompt = new ArrayList<Evidence>();
    for (int i = 0; i < evidence.size(); i++) {
      var e = evidence.get(i);
      String alias = "E" + (i + 1);
      aliases.put(alias, e.id());
      prompt.add(
          new Evidence(
              alias,
              e.documentId(),
              e.documentName(),
              e.versionId(),
              e.page(),
              e.paragraph(),
              e.startOffset(),
              e.endOffset(),
              e.text(),
              e.score()));
    }
    return new Context(prompt, aliases);
  }

  public static String restore(String answer, Map<String, String> aliases) {
    if (aliases.isEmpty() || answer == null) return answer;
    var pattern = Pattern.compile("\\[([^\\[\\]\\r\\n]+)]");
    var matcher = pattern.matcher(answer);
    var output = new StringBuffer();
    while (matcher.find()) {
      String id = aliases.get(matcher.group(1));
      if (id == null) throw new IllegalArgumentException("模型引用别名不属于本次检索结果");
      matcher.appendReplacement(output, java.util.regex.Matcher.quoteReplacement("[" + id + "]"));
    }
    matcher.appendTail(output);
    return output.toString();
  }

  private CitationAliases() {}
}
