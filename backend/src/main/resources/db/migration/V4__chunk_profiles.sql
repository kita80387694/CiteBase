ALTER TABLE document_version
  ADD COLUMN chunk_strategy text NOT NULL DEFAULT 'legacy',
  ADD COLUMN chunk_size integer NOT NULL DEFAULT 900,
  ADD COLUMN chunk_overlap integer NOT NULL DEFAULT 200,
  ADD CONSTRAINT valid_chunk_profile CHECK (
    chunk_strategy IN ('legacy','structure-v1') AND chunk_size BETWEEN 200 AND 4000
    AND chunk_overlap BETWEEN 0 AND LEAST(chunk_size / 2,1000));
ALTER TABLE chunk ADD COLUMN heading_path text NOT NULL DEFAULT '';
COMMENT ON COLUMN chunk.heading_path IS 'Original heading hierarchy metadata; never prepended to content or embedding input';
