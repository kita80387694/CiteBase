package io.citebase;

import io.micrometer.core.instrument.MeterRegistry;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class OperationsService {
  private final JdbcTemplate db;
  private final Environment env;
  private final MeterRegistry meters;

  public OperationsService(JdbcTemplate db, Environment env, MeterRegistry meters) {
    this.db = db;
    this.env = env;
    this.meters = meters;
  }

  public Map<String, Object> summary(String user, int minutes) {
    if (minutes < 5 || minutes > 1440)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "窗口须为 5–1440 分钟");
    List<Object> kinds = new ArrayList<>();
    for (TaskKind kind : TaskKind.values()) {
      var row =
          db.queryForMap(
              """
select count(*) filter(where status='QUEUED') as queued,
count(*) filter(where status='RETRY_WAIT') as "retryWait",
count(*) filter(where status='RUNNING') as running,
count(*) filter(where status='CANCEL_REQUESTED') as "cancelRequested",
count(*) filter(where status in ('RUNNING','CANCEL_REQUESTED') and lease_until>clock_timestamp()) as "activeLeases",
max(extract(epoch from clock_timestamp()-created_at)*1000) filter(where status in ('QUEUED','RETRY_WAIT')) as "oldestQueuedAgeMs"
from work_task where user_id=? and kind=?
""",
              user,
              kind.name());
      row.put("kind", kind.name());
      row.put(
          "terminal",
          db.queryForMap(
              """
select count(*) filter(where status='SUCCEEDED') as succeeded,
count(*) filter(where status='FAILED') as failed,
count(*) filter(where status='CANCELLED') as cancelled
from work_task where user_id=? and kind=? and finished_at>=clock_timestamp()-make_interval(mins=>?)
""",
              user,
              kind.name(),
              minutes));
      row.put("queueLatency", latency(user, kind, minutes, true));
      row.put("endToEndLatency", latency(user, kind, minutes, false));
      kinds.add(row);
    }
    var calls =
        db.queryForMap(
            """
select count(*) filter(where c.status='STARTED') as started,
count(*) filter(where c.status='RETURNED') as returned,
count(*) filter(where c.status='UNKNOWN') as unknown,
count(*) filter(where c.usage is not null and c.usage<>'null'::jsonb and
  (jsonb_typeof(c.usage->'promptTokens')='number' or jsonb_typeof(c.usage->'totalTokens')='number' or jsonb_typeof(c.usage->'completionTokens')='number')) as "usageAvailable",
count(*) filter(where not coalesce(jsonb_typeof(c.usage->'promptTokens')='number' or jsonb_typeof(c.usage->'totalTokens')='number' or jsonb_typeof(c.usage->'completionTokens')='number',false)) as "usageUnavailable"
from work_call c join work_task t on t.id=c.task_id where t.user_id=? and c.started_at>=clock_timestamp()-make_interval(mins=>?)
""",
            user,
            minutes);
    var result = new LinkedHashMap<String, Object>();
    result.put("generatedAt", Instant.now().toString());
    result.put("scope", "SELF");
    result.put("windowMinutes", minutes);
    result.put("modelMode", env.getProperty("citebase.mode", "mock"));
    result.put("kinds", kinds);
    result.put("calls", calls);
    result.put(
        "failures",
        db.queryForList(
            "select error_code as code,count(*) as count from work_task where user_id=? and"
                + " finished_at>=clock_timestamp()-make_interval(mins=>?) and status='FAILED' group"
                + " by error_code order by count(*) desc,error_code",
            user,
            minutes));
    result.put(
        "events",
        db.queryForList(
            "select e.event,count(*) as count from work_task_event e join work_task t on"
                + " t.id=e.task_id where t.user_id=? and"
                + " e.created_at>=clock_timestamp()-make_interval(mins=>?) group by e.event order"
                + " by e.event",
            user,
            minutes));
    return result;
  }

  private Map<String, Object> latency(String user, TaskKind kind, int minutes, boolean queue) {
    String end = queue ? "started_at" : "finished_at";
    return db.queryForMap(
        "select count(*) as \"sampleCount\",avg(ms) as \"meanMs\",percentile_cont(0.5) within"
            + " group(order by ms) as \"p50Ms\",percentile_cont(0.95) within group(order by ms) as"
            + " \"p95Ms\" from (select extract(epoch from ("
            + end
            + "-created_at))*1000 as ms from work_task where user_id=? and kind=? and "
            + end
            + ">=clock_timestamp()-make_interval(mins=>?)) s",
        user,
        kind.name(),
        minutes);
  }

  public Map<String, Object> local(String token) {
    String expected = env.getProperty("OPERATIONS_TOKEN", "");
    if (expected.length() < 32
        || token == null
        || !MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8)))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    var result = new LinkedHashMap<String, Object>();
    result.put("scope", "LOCAL_PROCESS");
    result.put("generatedAt", Instant.now().toString());
    result.put("uptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
    result.put("heapUsedBytes", ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getUsed());
    result.put("heapMaxBytes", ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getMax());
    var os = ManagementFactory.getOperatingSystemMXBean();
    result.put("availableProcessors", os.getAvailableProcessors());
    result.put(
        "processCpuLoad",
        os instanceof com.sun.management.OperatingSystemMXBean x && x.getProcessCpuLoad() >= 0
            ? x.getProcessCpuLoad()
            : null);
    List<Object> values = new ArrayList<>();
    for (var meter : meters.getMeters())
      if (meter.getId().getName().startsWith("citebase.tasks.")
          || meter.getId().getName().startsWith("hikaricp.connections")) {
        var readings = new LinkedHashMap<String, Object>();
        readings.put("name", meter.getId().getName());
        readings.put(
            "tags",
            meter.getId().getTags().stream()
                .map(t -> Map.of("key", t.getKey(), "value", t.getValue()))
                .toList());
        var samples = new LinkedHashMap<String, Object>();
        meter
            .measure()
            .forEach(
                m ->
                    samples.put(
                        m.getStatistic().toString(),
                        Double.isFinite(m.getValue()) ? m.getValue() : null));
        readings.put("values", samples);
        values.add(readings);
      }
    result.put("metrics", values);
    return result;
  }
}
