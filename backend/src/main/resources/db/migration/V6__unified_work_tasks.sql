CREATE TABLE work_task (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('INDEX','EVALUATION','AGENT')),
 user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 kb_id text NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
 idempotency_key text NOT NULL,request_hash text NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','RETRY_WAIT','CANCEL_REQUESTED','SUCCEEDED','FAILED','CANCELLED')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
 retry_generation integer NOT NULL DEFAULT 0,resume_without_attempt boolean NOT NULL DEFAULT false,
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,finished_at timestamptz,cancel_requested_at timestamptz,
 lease_owner text,lease_until timestamptz,last_heartbeat_at timestamptz,fencing_token bigint NOT NULL DEFAULT 0,
 error_code text,error_summary text,progress jsonb,
 UNIQUE(user_id,kind,idempotency_key)
);
CREATE INDEX work_task_claim_idx ON work_task(status,available_at,created_at,id);
CREATE INDEX work_task_lease_idx ON work_task(status,lease_until);
CREATE INDEX work_task_owner_idx ON work_task(user_id,kb_id,created_at DESC);
CREATE TABLE work_checkpoint (
 task_id text NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,checkpoint_key text NOT NULL,
 payload jsonb NOT NULL,fencing_token bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,checkpoint_key)
);
CREATE TABLE work_call (
 task_id text NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,call_id text NOT NULL,
 operation_key text NOT NULL,fencing_token bigint NOT NULL,provider text NOT NULL,request_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('STARTED','RETURNED','UNKNOWN')),
 usage jsonb,response jsonb,outcome text,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 PRIMARY KEY(task_id,call_id)
);
CREATE INDEX work_call_operation_idx ON work_call(task_id,operation_key,started_at);
CREATE TABLE index_chunk_stage (
 task_id text NOT NULL REFERENCES work_task(id) ON DELETE CASCADE,part_key text NOT NULL,
 source_hash text NOT NULL,embedding_model text NOT NULL,content_hash text NOT NULL,
 page integer NOT NULL,paragraph integer NOT NULL,start_offset integer NOT NULL,end_offset integer NOT NULL,
 heading_path text NOT NULL,content text NOT NULL,embedding vector NOT NULL,usage jsonb,
 PRIMARY KEY(task_id,part_key)
);
-- Upgrade only after old V5 application processes have stopped. Never mutate old completed raw evals.
INSERT INTO work_task(id,kind,user_id,kb_id,idempotency_key,request_hash,payload,status,attempts,max_attempts,available_at,created_at,error_code,error_summary)
SELECT t.id,'INDEX',k.user_id,k.id,t.id,v.content_hash,
 jsonb_build_object('documentId',d.id,'versionId',v.id,'sourceHash',v.content_hash,'legacy',true),
 CASE t.status WHEN 'SUCCESS' THEN 'SUCCEEDED' WHEN 'FAILED' THEN 'FAILED' ELSE 'QUEUED' END,
 t.attempts,3,t.available_at,t.created_at,
 CASE WHEN t.status='PROCESSING' THEN 'UPGRADE_INTERRUPTED' WHEN t.status='FAILED' THEN 'INDEX_FAILED' ELSE NULL END,
 CASE WHEN t.status='PROCESSING' THEN '旧进程已停止；升级后按剩余尝试预算恢复索引，先前在途用量未知' ELSE NULL END
FROM index_task t JOIN document d ON d.id=t.document_id JOIN document_version v ON v.id=t.version_id JOIN knowledge_base k ON k.id=d.kb_id;
-- Legacy terminal evaluation and agent artifacts remain unchanged and are not resubmitted.
