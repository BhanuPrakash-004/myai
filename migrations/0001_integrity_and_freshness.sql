-- Reviewed invariants that require PostgreSQL triggers or views.
-- Offsets are zero-based Unicode code points (not JavaScript UTF-16 code units).
INSERT INTO installation (singleton) VALUES (true);
INSERT INTO folders (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'Knowledge', '');

ALTER TABLE folders ADD CONSTRAINT folder_shape CHECK (
  (id = '00000000-0000-0000-0000-000000000001' AND parent_id IS NULL AND slug = '')
  OR (id <> '00000000-0000-0000-0000-000000000001' AND parent_id IS NOT NULL AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
ALTER TABLE folders ADD CONSTRAINT folder_name_not_empty CHECK (length(trim(name)) > 0);
ALTER TABLE folder_aliases ADD CONSTRAINT alias_path_normalized CHECK (path ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$');

CREATE FUNCTION guard_folder_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize structural changes, including concurrent moves in opposite directions.
  PERFORM pg_advisory_xact_lock(71202001);
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = '00000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'Cannot delete the root folder'; END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM folders WHERE id = NEW.parent_id
      UNION
      SELECT f.id, f.parent_id FROM folders f JOIN ancestors a ON f.id = a.parent_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN RAISE EXCEPTION 'Folder cycle is not allowed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER folder_hierarchy BEFORE INSERT OR UPDATE OR DELETE ON folders FOR EACH ROW EXECUTE FUNCTION guard_folder_hierarchy();

ALTER TABLE notes ADD CONSTRAINT notes_current_version_fk FOREIGN KEY (id, current_version)
  REFERENCES note_versions(note_id, version) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION guard_note_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot note_versions%ROWTYPE; current_note notes%ROWTYPE;
BEGIN
  SELECT * INTO current_note FROM notes WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO snapshot FROM note_versions WHERE note_id = current_note.id AND version = current_note.current_version;
  IF NOT FOUND OR snapshot.body <> current_note.body OR snapshot.title <> current_note.title OR snapshot.provenance <> current_note.provenance THEN
    RAISE EXCEPTION 'Current note must match its immutable version snapshot';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER note_snapshot_consistency AFTER INSERT OR UPDATE ON notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_note_snapshot();

CREATE FUNCTION guard_note_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title OR NEW.provenance IS DISTINCT FROM OLD.provenance THEN
    IF NEW.current_version <> OLD.current_version + 1 THEN RAISE EXCEPTION 'Content changes require the next note version'; END IF;
  ELSIF NEW.current_version <> OLD.current_version AND NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'Versions must increase monotonically';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER note_revision BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION guard_note_revision();

CREATE FUNCTION reject_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Snapshots are immutable; create a new version'; END $$;
CREATE TRIGGER immutable_note_version BEFORE UPDATE ON note_versions FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();
CREATE TRIGGER immutable_source BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();
CREATE TRIGGER immutable_chunk BEFORE UPDATE ON chunks FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();

CREATE FUNCTION guard_chunk_text() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_body text;
BEGIN
  SELECT body INTO source_body FROM note_versions WHERE note_id = NEW.note_id AND version = NEW.note_version;
  IF source_body IS NULL OR NEW.end_offset > char_length(source_body)
    OR substring(source_body FROM NEW.start_offset + 1 FOR NEW.end_offset - NEW.start_offset) <> NEW.body THEN
    RAISE EXCEPTION 'Chunk text/offsets must match the stored note version';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_chunk BEFORE INSERT ON chunks FOR EACH ROW EXECUTE FUNCTION guard_chunk_text();

CREATE FUNCTION guard_embedding_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chunker text; profile_chunker text;
BEGIN
  SELECT chunker_version INTO chunker FROM chunks WHERE id = NEW.chunk_id;
  SELECT chunker_version INTO profile_chunker FROM embedding_profiles WHERE id = NEW.profile_id;
  IF chunker IS DISTINCT FROM profile_chunker THEN RAISE EXCEPTION 'Embedding profile/chunker mismatch'; END IF;
  IF vector_norm(NEW.embedding) = 0 THEN RAISE EXCEPTION 'Zero vectors are not semantic embeddings'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_embedding BEFORE INSERT OR UPDATE ON chunk_embeddings FOR EACH ROW EXECUTE FUNCTION guard_embedding_profile();
CREATE FUNCTION guard_profile_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.model <> OLD.model OR NEW.dimensions <> OLD.dimensions OR NEW.normalization <> OLD.normalization OR NEW.chunker_version <> OLD.chunker_version THEN
    RAISE EXCEPTION 'Embedding profiles are immutable; build a new profile before activation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_profile BEFORE UPDATE ON embedding_profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_update();

CREATE FUNCTION guard_graph_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence_chunk chunks%ROWTYPE;
BEGIN
  SELECT * INTO evidence_chunk FROM chunks WHERE id = NEW.chunk_id;
  IF NOT FOUND OR NEW.end_offset > char_length(evidence_chunk.body)
    OR substring(evidence_chunk.body FROM NEW.start_offset + 1 FOR NEW.end_offset - NEW.start_offset) <> NEW.quote THEN
    RAISE EXCEPTION 'Graph evidence must quote the exact stored chunk';
  END IF;
  IF NEW.source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM note_sources WHERE note_id = evidence_chunk.note_id AND version = evidence_chunk.note_version AND source_id = NEW.source_id
  ) THEN RAISE EXCEPTION 'Graph evidence source does not belong to this note version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_graph_evidence BEFORE INSERT OR UPDATE ON graph_evidence FOR EACH ROW EXECUTE FUNCTION guard_graph_evidence();

CREATE FUNCTION guard_concept_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM graph_nodes WHERE id = NEW.node_id AND kind = 'concept' AND scope_folder_id = NEW.scope_folder_id) THEN
    RAISE EXCEPTION 'Concept alias scope must match its concept';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_concept_alias BEFORE INSERT OR UPDATE ON concept_aliases FOR EACH ROW EXECUTE FUNCTION guard_concept_alias();

CREATE FUNCTION guard_citation_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM chunks WHERE id = NEW.chunk_id AND position(NEW.quote IN body) > 0 AND length(NEW.quote) > 0) THEN
    RAISE EXCEPTION 'Citation quote must exist in the stored chunk';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_citation BEFORE INSERT OR UPDATE ON message_citations FOR EACH ROW EXECUTE FUNCTION guard_citation_quote();

CREATE FUNCTION invalidate_note_projections() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_version <> OLD.current_version OR NEW.lifecycle <> OLD.lifecycle THEN
    UPDATE processing_state SET status = 'stale', updated_at = now()
      WHERE note_id = NEW.id AND (note_version <> NEW.current_version OR NEW.lifecycle <> 'active');
    UPDATE study_cards SET stale = true
      WHERE note_id = NEW.id AND (note_version <> NEW.current_version OR NEW.lifecycle <> 'active');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER invalidate_projections AFTER UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION invalidate_note_projections();

CREATE VIEW current_chunks AS
  SELECT c.* FROM chunks c JOIN notes n ON n.id = c.note_id AND n.current_version = c.note_version WHERE n.lifecycle = 'active';
CREATE VIEW current_embeddings AS
  SELECT e.* FROM chunk_embeddings e JOIN current_chunks c ON c.id = e.chunk_id
  JOIN embedding_profiles p ON p.id = e.profile_id AND p.active AND p.chunker_version = c.chunker_version;
CREATE VIEW current_graph_evidence AS
  SELECT e.*, c.note_id, c.note_version FROM graph_evidence e JOIN current_chunks c ON c.id = e.chunk_id;
CREATE VIEW current_graph_edges AS
  SELECT e.* FROM graph_edges e
  WHERE EXISTS (SELECT 1 FROM current_graph_evidence v WHERE v.edge_id = e.id)
    AND NOT EXISTS (
      SELECT 1 FROM graph_nodes g JOIN notes n ON n.id = g.note_id
      WHERE g.id IN (e.from_node_id, e.to_node_id) AND n.lifecycle <> 'active'
    );
CREATE VIEW quiz_session_scores AS
  SELECT s.id AS session_id,
    (SELECT count(*)::integer FROM quiz_questions q WHERE q.session_id = s.id) AS total_questions,
    (SELECT count(*)::integer FROM quiz_attempts_v2 a WHERE a.session_id = s.id AND a.is_correct = true) AS score
  FROM quiz_sessions_v2 s;

COMMENT ON VIEW current_graph_edges IS 'Current source support, not proof of semantic truth. AI relations remain unreviewed until owner review.';
COMMENT ON VIEW current_chunks IS 'Use for retrieval. Historical chunks are retained for citations, never current answers.';
COMMENT ON COLUMN chunks.start_offset IS 'Zero-based Unicode code point offset in the immutable note version.';
COMMENT ON TABLE embedding_profiles IS '1536 dimensions in this release; changing dimensions requires an explicit schema migration and full rebuild.';
