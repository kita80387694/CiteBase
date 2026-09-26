package io.citebase;

import java.util.*;
import java.util.regex.Pattern;

public final class Citations {
  public static final String ABSTENTION = "无法根据当前资料回答：证据不足。";
  private static final Pattern REFERENCE = Pattern.compile("\\[([^\\[\\]\\r\\n]+)]");

  public record Check(
      boolean valid, boolean abstained, List<Evidence> citations, String answer, String error) {}

  public static Check validate(String answer, List<Evidence> evidence) {
    if (answer == null || answer.isBlank())
      return new Check(false, true, List.of(), ABSTENTION, "模型返回空回答");
    Map<String, Evidence> allowed = new HashMap<>();
    evidence.forEach(e -> allowed.put(e.id(), e));
    LinkedHashSet<Evidence> cited = new LinkedHashSet<>();
    var matches = REFERENCE.matcher(answer);
    String remainder = REFERENCE.matcher(answer).replaceAll("");
    if (remainder.indexOf('[') >= 0 || remainder.indexOf(']') >= 0)
      return new Check(false, true, List.of(), ABSTENTION, "模型引用括号残缺或格式无效");
    while (matches.find()) {
      Evidence e = allowed.get(matches.group(1));
      if (e == null) return new Check(false, true, List.of(), ABSTENTION, "模型引用不属于本次检索结果");
      cited.add(e);
    }
    boolean abstained =
        cited.isEmpty()
            ? answer.contains("无法根据当前资料回答")
            : answer.stripLeading().startsWith("无法根据当前资料回答");
    if (abstained) return new Check(true, true, List.of(), ABSTENTION, null);
    if (!abstained && cited.isEmpty())
      return new Check(false, true, List.of(), ABSTENTION, "模型回答未提供可验证引用");
    return new Check(true, abstained, List.copyOf(cited), answer, null);
  }

  private Citations() {}
}
