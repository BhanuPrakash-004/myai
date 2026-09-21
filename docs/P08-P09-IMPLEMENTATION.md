# P08 / P09 implementation — 2026-09-20

P08.01–P08.09 and P09.01–P09.07 are implemented. These phases replace the earlier keyword-only chat context with one current-source retrieval service and connect production indexing and graph handlers. They do not promise factual perfection or complete the P10 learning scheduler.

## Retrieval and answers

- `src/lib/retrieval/service.ts` is used by search, chat, typed search tools and topic-based study retrieval. The old `KnowledgeService.search` delegates to it. Administrative note listings still read canonical notes directly.
- Heading-aware Markdown chunks preserve exact text, immutable note version, SHA-256 content hash, Unicode code-point offsets and stable IDs. The bound is 2,400 code points with up to 240 points of overlap. Fitting code/list blocks stay together; oversized blocks split at lines and oversized lines at the bound. `token_count` stores a conservative UTF-8 byte upper bound, not an exact tokenizer count.
- Full-note lexical matching runs immediately after a save. Relevant passages are selected from the complete matching body, including late paragraphs, even before a worker processes it. Quoted phrases and technical tokens such as `C++`, `C#`, `Map.Entry`, `--dry-run` and `a.b` retain literal matching. Folder descendants and origin filters apply throughout.
- Lexical passage ranks and exact pgvector cosine ranks combine through reciprocal rank fusion: `sum(1 / (60 + rank))`, with one-based ranks. Model scores are not added to lexical scores. This uses PostgreSQL `ts_rank_cd`, not BM25. [RRF reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion), [pgvector operators and exact scans](https://github.com/pgvector/pgvector).
- Query vectors must match the active model/dimension/chunker profile. Profile changes disable the old space. A new profile activates only when all nonempty current notes have complete chunks and vectors. Pending edits retain current-text fallback. A retry/rebuild runs through Settings or `index:retry` / `index:rebuild`; active vectors are never replaced with hash vectors.
- Scoped candidate passages may be reranked through the existing OpenRouter client. Rerank failure retains fused order. Evidence selection limits repeated passages from the same note. Search has a fixed 200-candidate/result window, pagination and explicit limit warnings; reranking covers at most 60 candidates. Narrow large queries rather than interpreting a bounded window as exhaustive recall.
- Broad summaries use explicit folder coverage, one passage per note, pagination and a complete/partial flag. A long note or omitted note prevents a complete-coverage claim. Summary text does not pretend selected passages cover an entire large folder.
- Ask uses structured atomic claims and exact quote/citation checks, followed by a separate model support judgment. Unsupported claims are omitted; missing evidence produces a deterministic abstention with no model call. Ask creates no knowledge note. Derived evidence chunks may be materialized to make its citations durable.
- General Generate & Save remains explicitly separate, streams a complete generated note and resolves supplied evidence IDs to stable links. It is general model output, not an independently verified answer. Earlier conversation text cannot grant tool permissions or substitute for source evidence.
- `/evidence/[id]` displays the exact historical passage, offsets, version and source dates. It explicitly labels stale/inactive evidence. Chat stores validated quote references in `message_citations`, and checks note version/lifecycle/scope again in its final transaction. Folder moves during remote inference cannot leak old-scope sources.

## Worker and graph

- `src/lib/worker/projections.ts` registers real chunk, embedding and graph handlers. Local chunking and deterministic folder/source links work with AI indexing disabled. Graph extraction does not depend on embedding availability.
- AI calls occur outside the publication transaction. Intermediate per-chunk extraction/embedding results are staged in `projection_cache`; interrupted retries reuse successful work. Only the fenced stage publication makes a full projection ready. Embedding staging is removed after publication; graph extraction staging supports deterministic rebuilds without another provider call for the same chunk/model/extractor.
- A provider request interrupted before its result is durably staged may run again and incur another charge. Database effects are idempotent; provider billing is not exactly once.
- Graph identities cover notes, folder topics, sources and concepts. Deterministic relationships reflect actual folder membership, ancestry and source linkage. Current graph views reject obsolete folder-ancestry links immediately on a move; the folder operation queues current-note structural refresh.
- AI relationships remain proposed. Each has model/extractor provenance and exact chunk-relative quote offsets; note version is obtained through the immutable chunk. Extracted text is untrusted data. Quote existence validates provenance, not semantic truth.
- Identical concept labels do not automatically merge meanings. Default sense identity includes folder, source note and concept description. Owner aliases and explicit same-folder merges allow cross-note equivalence. Conflicting relations remain separately inspectable.
- Owner acceptance/correction creates curated relationships. Removal suppresses the original edge; retries and rebuilds preserve that suppression. Expected revisions reject stale edge edits; operation keys deduplicate mutations. Edits/trash invalidate source support without deleting curated history. Unsupported historical curation remains stored but is excluded from current discovery.
- Optional graph expansion starts from a bounded set of seed passages, follows a bounded relationship neighborhood and returns supporting current passages. It does not feed bare relations to the answer as proof. Scope, lifecycle, version and query filters are reapplied. The setting defaults off so owners can compare it with the baseline.
- `/graph` provides a focused interactive neighborhood and accessible relationship list, exact-source inspection, proposal/curated labels, acceptance, correction, removal, aliases and reviewed merge. Desktop and mobile navigation include it. It intentionally avoids a whole-library graph canvas.

## Storage and deployment

Apply the explicit migrations with `npm run db:migrate`, or rebuild/start Compose, whose migration service runs before web and worker:

1. `0006_retrieval_graph.sql`: edge suppression/revision and supported/current graph views.
2. `0007_retrieval_indexes.sql`: chunk and graph evidence lookup indexes.
3. `0008_projection_cache.sql`: durable inference staging.

There are 41 application tables. Full Markdown, original sources, versions, citations, graph, vectors and staged results live in PostgreSQL. Attachments remain in the configured persistent attachment volume. No additional runtime dependency or graph/vector server was added. Existing migrations were not changed.

For existing notes, run `npm run index:rebuild` after deploying the matching web and worker. Enable AI indexing and select compatible OpenRouter structured/embedding models in Settings; embeddings require the installed 1,536-dimensional schema. AI indexing and graph expansion are separate toggles. A complete inactive profile whose final missing source is removed can be activated by retrying/rebuilding any remaining note.

An API key found in the example configuration was preserved in ignored `.env.local` and removed from `.env.example`. Model selections were preserved locally where not already configured. No credential is included in this report or the public template.

## Acceptance evidence

The focused integration suite executes real production services, PostgreSQL/pgvector and production worker publication with synthetic OpenRouter transport responses. It does not measure a real model's semantic quality.

- Eight P08/P09 scenarios across full and targeted runs: exact Unicode/late/code retrieval, scoped fallback, semantic fusion and profile change, quote/claim gates and historical citations, graph correction/rebuild, same-label ambiguity, reviewed cross-note expansion, interrupted staging/retry, coverage/pagination, conflicting accounts and folder movement during rerank.
- Seven initial retrieval/graph scenarios plus 12 storage/migration and six worker regressions passed together (25 checks). The added conflict/move scenario and interruption scenario passed in a focused run.
- Synthetic three-query recall@2: keyword 2/3, hybrid 3/3; observed hybrid latency 43–49 ms in that run and nine provider requests up to that measurement. This is a wiring/behavior benchmark using controlled vectors, not an OpenRouter quality score or production latency promise.
- Reviewed prerequisite bridge: expected-source recall@8 rose from 1/2 to 2/2 with graph expansion; out-of-scope passages: zero. Same-label different meanings remained separate.
- Citation/support fixture retained one supported claim and rejected two proposed claims (one invalid ID, one unsupported detail). The conflicting-source fixture retained both attributed accounts with their own exact citations. These assertions evaluate the pipeline's handling of provider judgments, not the reliability of a live judge.
- Twelve existing authenticated HTTP/restart scenarios passed. The added P08/P09 HTTP scenario passed after correcting fixture status expectations: exact evidence SSR, protected graph, same-origin enforcement and no-key empty Ask abstention with unchanged note count.
- Final production build/TypeScript, full plus targeted lint, Drizzle schema consistency and whitespace checks passed. Focused production study grading/review and exact-token regressions passed after the final retrieval adjustment.
- Browser selection returned `No browser is available`, and discovery returned an empty list. Visual, keyboard and mobile interaction acceptance remains unverified.
- Live OpenRouter compatibility/support quality was not run in this phase. A locally configured key does not prove that selected models support structured output, native rerank or the requested vector dimensions. Run `npm run ai:smoke -- --live` or Settings live checks with the deployed database. P05.11 remains open.

Next implementation: **P10.01**, source-linked revision/practice and scheduling. P11 backup/restore and P12 public deployment/accessibility/release acceptance remain open. The generated migrations and Docker packaging are deployable artifacts, not a completed public release rehearsal.
