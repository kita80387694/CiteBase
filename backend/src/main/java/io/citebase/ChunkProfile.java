package io.citebase;

import java.util.Set;

/** Immutable version-level indexing configuration; sizes are UTF-16 code units. */
public record ChunkProfile(String strategy, int size, int overlap) {
  public ChunkProfile {
    if (strategy == null || !Set.of("legacy", "structure-v1").contains(strategy))
      throw new IllegalArgumentException("chunkStrategy 必须为 legacy 或 structure-v1");
    if (size < 200 || size > 4000) throw new IllegalArgumentException("chunkSize 必须在 200–4000 之间");
    if (overlap < 0 || overlap > Math.min(size / 2, 1000))
      throw new IllegalArgumentException("chunkOverlap 必须在 0 到 min(chunkSize/2,1000) 之间");
  }

  public static ChunkProfile defaults() {
    return new ChunkProfile("legacy", 900, 200);
  }

  public static ChunkProfile of(String strategy, Integer size, Integer overlap) {
    return new ChunkProfile(
        strategy == null ? "legacy" : strategy,
        size == null ? 900 : size,
        overlap == null ? 200 : overlap);
  }
}
