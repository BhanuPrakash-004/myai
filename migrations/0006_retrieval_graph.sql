ALTER TABLE "graph_edges" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE VIEW supported_graph_edges AS
  SELECT e.*
  FROM graph_edges e
  WHERE EXISTS (SELECT 1 FROM current_graph_evidence v WHERE v.edge_id=e.id)
    AND NOT EXISTS (SELECT 1 FROM graph_nodes g LEFT JOIN notes n ON n.id=g.note_id
      WHERE g.id IN(e.from_node_id,e.to_node_id) AND (n.lifecycle<>'active' OR g.metadata->>'mergedInto' IS NOT NULL))
    AND (e.origin<>'deterministic' OR e.relation<>'contains' OR EXISTS (
      SELECT 1 FROM graph_nodes a JOIN graph_nodes b ON b.id=e.to_node_id
      LEFT JOIN notes n ON n.id=b.note_id LEFT JOIN folders f ON f.id=b.scope_folder_id
      WHERE a.id=e.from_node_id AND a.kind='topic'
        AND ((b.kind='note' AND n.folder_id=a.scope_folder_id) OR (b.kind='topic' AND f.parent_id=a.scope_folder_id))));
--> statement-breakpoint
CREATE OR REPLACE VIEW current_graph_edges AS
  SELECT e.id,e.from_node_id,e.to_node_id,e.relation,e.origin,e.review_state,e.confidence,e.model,e.extractor_version,e.created_at
  FROM supported_graph_edges e WHERE NOT e.disabled;
