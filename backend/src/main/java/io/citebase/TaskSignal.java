package io.citebase;

public class TaskSignal extends RuntimeException {
  private final String code;

  public TaskSignal(String code) {
    super(code);
    this.code = code;
  }

  public String code() {
    return code;
  }
}
