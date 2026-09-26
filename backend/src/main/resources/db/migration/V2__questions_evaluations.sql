CREATE TABLE question_history(id text PRIMARY KEY,user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,kb_id text NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,result jsonb NOT NULL,config jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE evaluation_run(id text PRIMARY KEY,user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,kb_id text NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,name text NOT NULL,status text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX question_owner ON question_history(user_id,kb_id);
CREATE INDEX evaluation_owner ON evaluation_run(user_id);
