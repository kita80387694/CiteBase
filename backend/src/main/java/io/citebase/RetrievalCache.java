package io.citebase;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class RetrievalCache {
  private record Entry(byte[] json, long expires) {}

  private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>(16, .75f, true);
  private final ObjectMapper mapper =
      new ObjectMapper().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
  private final int capacity, maxBytes;
  private final long ttlNanos;
  private final LongSupplier clock;
  private int bytes;

  @org.springframework.beans.factory.annotation.Autowired
  RetrievalCache(
      @Value("${RETRIEVAL_CACHE_MAX_ENTRIES:128}") int capacity,
      @Value("${RETRIEVAL_CACHE_TTL_SECONDS:300}") int seconds,
      @Value("${RETRIEVAL_CACHE_MAX_BYTES:8000000}") int maxBytes) {
    this(capacity, seconds, maxBytes, System::nanoTime);
  }

  RetrievalCache(int capacity, int seconds, int maxBytes, LongSupplier clock) {
    if (capacity < 1
        || capacity > 10000
        || seconds < 1
        || seconds > 3600
        || maxBytes < 1024
        || maxBytes > 100000000) throw new IllegalArgumentException("检索缓存配置越界");
    this.capacity = capacity;
    this.ttlNanos = seconds * 1000000000L;
    this.maxBytes = maxBytes;
    this.clock = clock;
  }

  String key(Object value) {
    try {
      return AuthService.hash(mapper.writeValueAsBytes(value));
    } catch (Exception e) {
      throw new IllegalArgumentException("缓存key无效", e);
    }
  }

  synchronized RetrievalOutcome get(String key) {
    var entry = entries.get(key);
    if (entry == null) return null;
    if (clock.getAsLong() >= entry.expires) {
      remove(key);
      return null;
    }
    try {
      return mapper.readValue(entry.json, RetrievalOutcome.class);
    } catch (Exception e) {
      remove(key);
      throw new IllegalStateException("缓存解码失败", e);
    }
  }

  synchronized void put(String key, RetrievalOutcome outcome) {
    if (outcome.error() != null) return;
    try {
      byte[] encoded = mapper.writeValueAsBytes(outcome);
      if (encoded.length > maxBytes) return;
      remove(key);
      while (!entries.isEmpty()
          && (entries.size() >= capacity || bytes + encoded.length > maxBytes))
        remove(entries.keySet().iterator().next());
      entries.put(key, new Entry(encoded, clock.getAsLong() + ttlNanos));
      bytes += encoded.length;
    } catch (Exception e) {
      throw new IllegalStateException("缓存编码失败", e);
    }
  }

  synchronized void remove(String key) {
    var old = entries.remove(key);
    if (old != null) bytes -= old.json.length;
  }

  Map<String, Object> configuration() {
    return Map.of(
        "maxEntries",
        capacity,
        "ttlSeconds",
        ttlNanos / 1000000000L,
        "maxBytes",
        maxBytes,
        "scope",
        "process-local",
        "version",
        "authorized-retrieval-v1");
  }

  synchronized int size() {
    return entries.size();
  }
}
