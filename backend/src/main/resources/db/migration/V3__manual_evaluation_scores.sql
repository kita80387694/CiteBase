CREATE TABLE evaluation_score (
 id text PRIMARY KEY,
 evaluation_id text NOT NULL REFERENCES evaluation_run(id) ON DELETE CASCADE,
 case_id text NOT NULL,
 retrieval_mode text NOT NULL CHECK (retrieval_mode IN ('vector','hybrid')),
 answer_correct boolean NOT NULL,
 source text NOT NULL CHECK (source='human'),
 rationale text NOT NULL,
 rule_version text NOT NULL,
 citation_supported boolean,
 error_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
 scored_by text NOT NULL REFERENCES app_user(id),
 scored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
CREATE INDEX evaluation_score_run_idx ON evaluation_score(evaluation_id,sequence_id);
