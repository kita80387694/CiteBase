-- No retrospective event fabrication: history begins at this migration.
CREATE TABLE work_task_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 task_id text NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,
 event text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX work_task_event_task_time_idx ON work_task_event(task_id,created_at);
