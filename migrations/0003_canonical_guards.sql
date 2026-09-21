-- Existing optional P02 imports get a stable route without requiring files.
INSERT INTO note_routes(note_id,path) SELECT id,id::text || '.md' FROM notes ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX note_routes_case_unique ON note_routes(lower(path));
CREATE UNIQUE INDEX note_aliases_case_unique ON note_aliases(lower(path));
CREATE FUNCTION guard_note_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(71202001);
  IF NEW.path !~ '\.md$' OR NEW.path ~ '(^/|(^|/)\.\.?(/|$)|//|[[:cntrl:]])' THEN
    RAISE EXCEPTION 'Unsafe note path';
  END IF;
  IF EXISTS(SELECT 1 FROM note_routes WHERE lower(path)=lower(NEW.path) AND note_id<>NEW.note_id)
    OR EXISTS(SELECT 1 FROM note_aliases WHERE lower(path)=lower(NEW.path) AND note_id<>NEW.note_id) THEN
    RAISE EXCEPTION 'A note or alias reserves this path';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER note_route_namespace BEFORE INSERT OR UPDATE ON note_routes FOR EACH ROW EXECUTE FUNCTION guard_note_path();
CREATE TRIGGER note_alias_namespace BEFORE INSERT OR UPDATE ON note_aliases FOR EACH ROW EXECUTE FUNCTION guard_note_path();

-- Structural metadata changes must also invalidate projections through a new version.
CREATE OR REPLACE FUNCTION guard_note_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title OR NEW.provenance IS DISTINCT FROM OLD.provenance
    OR NEW.folder_id IS DISTINCT FROM OLD.folder_id OR NEW.lifecycle IS DISTINCT FROM OLD.lifecycle
    OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.importance IS DISTINCT FROM OLD.importance THEN
    IF NEW.current_version <> OLD.current_version + 1 THEN RAISE EXCEPTION 'Changes require the next note version'; END IF;
  ELSIF NEW.current_version <> OLD.current_version AND NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'Versions must increase monotonically';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Auth account credentials remain unique even if an HTTP endpoint is bypassed.
CREATE UNIQUE INDEX one_owner_credential ON auth_accounts(user_id) WHERE provider_id='credential';
ALTER TABLE reading_items ADD CONSTRAINT reading_answer_pair CHECK ((remembered IS NULL) = (answered_at IS NULL));
