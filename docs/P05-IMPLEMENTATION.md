# P05 — OpenRouter client and durable worker runtime

Date: 2026-09-19. P05.01–P05.10 implemented. **P05.11 remains pending because OPENROUTER_API_KEY is not configured.** Next implementation: P06.01, folder explorer/direct capture.

The request repeated P05; this session implements P05 only. It does not mark the later workspace, indexing or graph phases complete.

## Implemented behavior

| Tasks | Implementation | Result |
| --- | --- | --- |
| P05.01–02 | src/lib/ai/openrouter.ts, preferences.ts, errors.ts, index.ts | One Node-only OpenRouter client with fixed endpoints, independent task models, validated settings and sanitized errors. Redirects cannot forward the bearer token to another origin. Provider routing requires support for requested parameters. Live task checks establish actual account/model compatibility separately. |
| P05.03 | openrouter.ts; src/app/api/chat/route.ts | SSE framing uses eventsource-parser 3.0.6. Comments, fragmented UTF-8, usage-only frames and repeated terminal usage are supported. Completion requires stop plus the DONE marker. Length/refusal/error/malformed/disconnected streams remain incomplete and cannot save a generated note. Cancellation/timeout propagates; a partially received stream is never automatically retried. |
| P05.04 | ai/contracts.ts, content.ts; storage/study.ts | Strict JSON-schema requests plus local Zod validation for improvement, graph extraction and MCQs. Graph extraction also checks endpoint membership and exact Unicode code-point quote spans. Improvement returns a proposal without editing a note. Preview/apply UI remains P06. |
| P05.05 | openrouter.ts; storage/embedding-profiles.ts | Batch embeddings validate complete unique indices, returned model, dimensions, finite float32-compatible values and nonzero vectors. Results carry the complete profile and fingerprint. Production calls record an idempotent inactive database profile; activation requires the future complete reindex. No hash vectors or fake semantic results. |
| P05.06 | openrouter.ts; api/chat/route.ts | Rerank receives only already-scoped candidates. Validated indices map back to original IDs, ties use original order, and failures fall back to original candidates with null scores and an explicit reason. Chat optionally reranks current keyword candidates. Full passage retrieval/citation evaluation remains P08. |
| P05.07–08 | worker/runtime.ts, admin.ts; scripts/worker.ts, indexing.ts | Graphile task registry, bounded concurrency/retries, stage/worker heartbeats, guarded projection publishing, restart recovery and retry/rebuild commands. Production projection handlers intentionally remain P08/P09; absent handlers report pending rather than ready. |
| P05.09 | storage/settings.ts, usage.ts; settings page/API; vector status/reindex API | Independent models, indexing/rerank toggles, per-response output limit, daily request/token allowances, reported cost/usage, live synthetic checks and processing/retry controls. Secrets remain environment-only. |
| P05.10 | tests/openrouter.test.ts, integration/worker.test.ts, updated HTTP suite | Actual client/service tests cover provider failures, stream truncation, malformed schemas/vectors/reranks, usage races, duplicate jobs, changed source/configuration, transaction rollback and a killed worker. Manual capture and current keyword retrieval remain available without AI. |
| P05.11 | scripts/ai-smoke.ts; settings/test API | Opt-in live checks implemented, but not run successfully without the owner's key and compatible models. This checkbox remains open. |

The obsolete OpenAI-compatible adapter and legacy AI config module were removed. Existing chat and quiz generation now use the unified client. No arbitrary provider URL setting or secret-setting endpoint was introduced.

## Storage and runtime invariants

Migration 0004_ai_runtime.sql adds stage run tokens/configuration fingerprints/heartbeats, token reservations and worker_heartbeats. There are 40 typed application tables plus Graphile's schema. Existing applied migrations were preserved; Drizzle reports no remaining table-schema drift.

Usage admission takes a PostgreSQL advisory transaction lock before checking the UTC day's totals and inserting a reservation. Every external attempt, including retry attempts, gets its own record. Valid reported token counts replace reservations; missing or interrupted usage stays reserved for that day. The ledger stores task/model/request ID/duration/outcome and provider-reported tokens/cost, not copied prompts or provider error bodies. Reported cost may be incomplete; the allowance is an application admission control, not a guaranteed dollar billing ceiling.

A worker acquires a per-note/version/stage advisory lock and records a unique run token before preparing a result. Preparation runs outside the publishing transaction with a cancellation signal and bounded duration. Publishing acquires the current-note lock, verifies that the run token and relevant model configuration still match, and commits projection writes and readiness together. A note edit, lifecycle change or relevant settings change prevents obsolete results from becoming ready. SQL publication uses bounded lock/statement timeouts.

Transient failures use Graphile's exponential backoff and an eight-attempt stage limit. Explicit retry resets the affected attempts. Duplicate delivery cannot publish twice. A terminated worker's abandoned processing state is recoverable after its heartbeat becomes stale and the stage lock is available. Recovery creates a replacement job without waiting for Graphile's abandoned job lock; the stage lock/token still fences duplicate execution. No external inference service can guarantee exactly-once billing after a network interruption.

## Deployment and commands

Docker Compose now packages the web/API, worker, one-shot migration service and PostgreSQL. Worker and maintenance commands run as the non-root node user. The worker has no public port or HTTP setup route. PostgreSQL and attachment volumes retain application data.

~~~sh
docker compose up -d --build --wait
docker compose exec worker node --import tsx scripts/indexing.ts status
docker compose exec worker node --import tsx scripts/indexing.ts retry
docker compose exec worker node --import tsx scripts/ai-smoke.ts --live
~~~

Local development, after migrations:

~~~sh
npm run worker
npm run worker:status
npm run index:retry
npm run index:rebuild -- NOTE_UUID
npm run ai:smoke -- --live
~~~

The live command sends only synthetic examples and can incur OpenRouter charges. It reports each exact model, embedding dimensions, duration and sanitized result. Configure OPENROUTER_API_KEY, OPENROUTER_CHAT_MODEL and OPENROUTER_STRUCTURED_MODEL; verify embedding/rerank model availability for the account. The script explicitly enables its synthetic rerank check without changing the owner's saved toggle.

Retry/rebuild requests are owner-guarded and operate on current active versions. Whole-library requests are capped at 1,000 notes; larger libraries can target individual note IDs. Changing embedding configuration deactivates the old active embedding profile and invalidates in-flight indexing. P08 must activate a replacement only after successful reindexing.

## Validation record

- npm test: 12 passed, including eight focused OpenRouter cases.
- PostgreSQL integration: 31 scenarios passed across the suite and focused reruns. The initial upgrade assertion needed the new migration added to its expected list; the upgrade then passed. The new worker suite includes actual Graphile dispatch and termination of a separate fixture worker process.
- npm run test:http: 9 passed against a real built Next server, including protected AI settings, invalid dimensions, unavailable live checks and retry endpoints.
- TypeScript, ESLint and Next production build passed. Drizzle reported no schema changes after generating migration 0004. Installing the pinned SSE parser reported zero npm vulnerabilities.
- Docker deployment rehearsal passed: images built, migration completed, and PostgreSQL/web/worker became healthy. A synthetic canonical note reached the worker and correctly remained pending with HANDLER_NOT_IMPLEMENTED. Restarting the worker preserved that note/version and pending stages, recorded the previous worker as stopped, and registered a fresh live heartbeat.
- Live OpenRouter: not verified. Only configuration presence was inspected; no credential value was printed. No key/chat/structured model was configured.

Testing stayed on synthetic inputs and isolated randomly named databases. Existing owner/mock vault data was not migrated, reset or deleted. No broad browser or live-RAG benchmark was claimed.

## Limits and next session

P05 is infrastructure plus current chat/quiz integration. The production handler registry is deliberately empty until P08 (chunks/embeddings) and P09 (graph), as specified by P05.08. A healthy worker or a successful queued receipt does not imply an indexed graph. The runtime's prepare/publish contract is tested with deterministic fixture handlers, not fake production projections.

Chat currently retrieves keyword candidates and can rerank them. Full semantic retrieval, diverse passage selection, citation freshness and factual-support evaluation are still P08/P09. Strict schemas and exact quote checks establish structure/source presence, not factual truth. Model capability is established by explicit live task checks; configured model names alone are not proof of availability.

Remaining P05 acceptance: configure the key/models and run P05.11. Next code task: P06.01; its improvement flow can use AIContentService while live-provider compatibility remains separately recorded.

## Primary implementation references

- [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming): SSE comments, repeated terminal usage and midstream errors informed completion handling.
- [OpenRouter embeddings](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request) and [native rerank](https://openrouter.ai/docs/api/api-reference/rerank/submit-a-rerank-request): request/response contracts.
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs): JSON-schema requests and model/provider support requirements.
- [Graphile exponential backoff](https://worker.graphile.org/docs/exponential-backoff) and installed graphile-worker 0.17.3 types: durable dispatch, abort signals and retries.
- Installed Next.js route/client-boundary guides were read before framework changes; the React best-practices skill guided the settings integration.
