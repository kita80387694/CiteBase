ALTER TABLE evaluation_run ADD COLUMN task_id text REFERENCES work_task(id) ON DELETE CASCADE;
ALTER TABLE evaluation_run ADD COLUMN normalized_request jsonb;
ALTER TABLE evaluation_run ADD COLUMN migration_error text;
-- Deployment requires all V5 processes stopped. Preserve legacy payload bytes and partial rows.
UPDATE evaluation_run SET status='FAILED',migration_error='UPGRADE_INTERRUPTED'
 WHERE task_id IS NULL AND status='RUNNING';
CREATE TABLE evaluation_snapshot(
 evaluation_id text NOT NULL REFERENCES evaluation_run(id) ON DELETE CASCADE,
 document_id text NOT NULL REFERENCES document(id) ON DELETE CASCADE,
 version_id text NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
 metadata jsonb NOT NULL,
 PRIMARY KEY(evaluation_id,document_id)
);
CREATE TABLE evaluation_item(
 evaluation_id text NOT NULL REFERENCES evaluation_run(id) ON DELETE CASCADE,
 case_id text NOT NULL, mode text NOT NULL CHECK(mode IN ('vector','hybrid')),
 ordinal integer NOT NULL, case_payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), max_attempts integer NOT NULL DEFAULT 2 CHECK(max_attempts>0),
 available_at timestamptz NOT NULL DEFAULT now(), fencing_token bigint,
 result jsonb, error_code text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(evaluation_id,case_id,mode), UNIQUE(evaluation_id,ordinal)
);
CREATE TABLE evaluation_attempt(
 id text PRIMARY KEY, evaluation_id text NOT NULL, case_id text NOT NULL, mode text NOT NULL,
 attempt_number integer NOT NULL, fencing_token bigint NOT NULL,
 status text NOT NULL CHECK(status IN ('STARTED','COMPLETED','FAILED','UNKNOWN')),
 result jsonb, error_code text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(evaluation_id,case_id,mode) REFERENCES evaluation_item(evaluation_id,case_id,mode) ON DELETE CASCADE,
 UNIQUE(evaluation_id,case_id,mode,attempt_number)
);
CREATE INDEX evaluation_items_pending ON evaluation_item(evaluation_id,status,available_at,ordinal);
ALTER TABLE evaluation_score ADD COLUMN result_digest text;
