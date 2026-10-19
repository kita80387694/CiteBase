create table agent_run (
 id text primary key, user_id text not null references app_user(id),
 kb_id text not null references knowledge_base(id) on delete cascade,
 idempotency_key text not null, request_hash text not null,
 status text not null check(status in ('CREATED','RUNNING','CANCEL_REQUESTED','COMPLETED','FAILED','CANCELLED','INTERRUPTED')),
 request jsonb not null, config jsonb not null, snapshot jsonb not null,
 result jsonb, error_code text, created_at timestamptz not null default now(),
 started_at timestamptz, finished_at timestamptz, cancel_requested_at timestamptz,
 unique(user_id,idempotency_key)
);
create index agent_run_owner_kb on agent_run(user_id,kb_id,created_at desc);
create table agent_step (
 run_id text not null references agent_run(id) on delete cascade,
 sequence integer not null, payload jsonb not null, created_at timestamptz not null default now(),
 primary key(run_id,sequence)
);
