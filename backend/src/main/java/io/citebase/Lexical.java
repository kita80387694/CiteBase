package io.citebase;

import java.util.*;
import java.util.regex.*;

/** Unicode Han bigrams plus Latin/numeric words; deliberately no linguistic segmentation. */
public final class Lexical {
  private static final Pattern PART =
      Pattern.compile("[\\p{IsHan}]+|[a-z0-9_]+", Pattern.CASE_INSENSITIVE);

  public static String tokens(String text) {
    List<String> out = new ArrayList<>();
    var matcher = PART.matcher(text.toLowerCase(Locale.ROOT));
    while (matcher.find()) {
      String part = matcher.group();
      if (Character.UnicodeScript.of(part.codePointAt(0)) == Character.UnicodeScript.HAN) {
        int[] points = part.codePoints().toArray();
        if (points.length == 1) out.add(part);
        for (int i = 0; i < points.length - 1; i++) out.add(new String(points, i, 2));
      } else out.add(part);
    }
    return String.join(" ", out);
  }

  private Lexical() {}
}
