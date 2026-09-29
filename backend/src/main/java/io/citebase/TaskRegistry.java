package io.citebase;

import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

@Component
public final class TaskRegistry {
  private final ObjectProvider<TaskHandler> handlers;

  public TaskRegistry(ObjectProvider<TaskHandler> handlers) {
    this.handlers = handlers;
  }

  public TaskHandler require(TaskKind kind) {
    var found = handlers.orderedStream().filter(h -> h.kind() == kind).toList();
    if (found.size() != 1) throw new IllegalStateException("Task handler must be unique: " + kind);
    return found.getFirst();
  }

  public Set<TaskKind> kinds() {
    var result = EnumSet.noneOf(TaskKind.class);
    handlers
        .orderedStream()
        .forEach(
            h -> {
              if (!result.add(h.kind())) throw new IllegalStateException("Duplicate task handler");
            });
    return result;
  }
}
