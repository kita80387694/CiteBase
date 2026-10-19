package io.citebase;

public enum TaskState {
  QUEUED,
  RUNNING,
  RETRY_WAIT,
  CANCEL_REQUESTED,
  SUCCEEDED,
  FAILED,
  CANCELLED
}
