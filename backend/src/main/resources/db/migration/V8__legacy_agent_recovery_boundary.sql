-- Deployment must stop V5 workers before upgrading this database (they have no fencing).
-- Historical terminal records and raw outputs are untouched. Unknown old model calls are
-- never automatically replayed: there is no reliable lease/checkpoint to authorize recovery.
UPDATE agent_run SET status='INTERRUPTED',error_code='UNSAFE_TO_RESUME',finished_at=clock_timestamp()
WHERE status IN ('RUNNING','CANCEL_REQUESTED')
  AND NOT EXISTS (SELECT 1 FROM work_task t WHERE t.id=agent_run.id AND t.kind='AGENT');
