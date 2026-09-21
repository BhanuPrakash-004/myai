# P12 release implementation and evidence

Date: 2026-09-21. This records implemented behavior separately from public-host acceptance. No release was published and no owner database was used for the rehearsal.

## Implementation

- Standalone web and maintenance/worker images use pinned Node 22, locked npm dependencies and UID 1000. PostgreSQL 17/pgvector and Caddy are digest-pinned. Database, attachment and certificate volumes persist. PostgreSQL is not published in production Compose. Web binds loopback; Caddy is the public ingress.
- Compose exposes separate image tags for matching web/maintenance builds, forwards graph expansion configuration, and uses an init process/graceful shutdown. `scripts/setup-env.mjs` generates independent secrets without overwriting a deployment or displaying credentials.
- `/api/health` is liveness. `/api/ready` checks valid app/auth configuration, a bounded database connection, current schema and provisioned owner. It returns only `ready`/`not_ready`, never owner data. Container health uses readiness; AI credentials and worker availability do not prevent manual-note readiness. Existing Settings and processing APIs expose detailed owner-only worker/index/AI degradation.
- `compose.https.yml` and `deploy/Caddyfile` provide automatic TLS, request-size/upload-time limits, security headers and SSE-compatible transport. Caddy's native SSE flushing preserves client cancellation. No authenticated response caching is configured.
- Request bodies have a 30-second deadline in addition to byte limits. Atomic PostgreSQL usage admission limits provider work across web/worker to four concurrent calls. The 120-second slot expiry exceeds the client’s 90-second call deadline; abandoned reservations remain counted toward the daily budget.
- Markdown skips raw HTML, keeps safe URL handling and renders external images as explicit links instead of automatic tracking requests. Attachment downloads remain authenticated, `nosniff`, octet-stream and attachment disposition. `.env`, database files, vaults, backups, browser traces and tests stay outside runtime build inputs.
- Accessibility fixes: named collapsed navigation, current-page indication, skip link, visible button focus, modal mobile navigation with Escape/focus return, semantic header links instead of nested interactive elements, and readable helper-text contrast. The superseded explorer import branch was removed; imports use the preview/conflict flow.
- README now covers the product, data locations, setup, local development, online deployment, AI compatibility, maintenance, backup/upgrade/rollback and troubleshooting. Contribution/security guidance and an explicitly synthetic import example are included.

No new SQL migration was needed; the current schema still has eleven migrations through `0010_attachment_purge.sql`.

## Reproducible checks

Host: Windows/PowerShell, Node 22.14.0, Docker Desktop Linux engine 29.7.2. Containers use the pinned Linux Node runtime, PostgreSQL 17/pgvector 0.8.2 and Caddy 2.10.2. Chromium checks cover 1440×1000 desktop and 390×844 mobile viewports.

```sh
npm run lint
npm run typecheck
npm run build
docker compose -f compose.test.yml up -d --wait
node --import tsx --test tests/integration/worker.test.ts tests/integration/storage.test.ts tests/integration/study-portability.test.ts
node --import tsx --test tests/openrouter.test.ts tests/integration/worker.test.ts
npm run test:http
npx playwright install chromium
node scripts/release-check.mjs
```

The release script creates a random `myai-release-*` Compose project with synthetic secrets and no OpenRouter key. It runs real migrations and owner provisioning; saves/replays a note, stores an attachment, restarts web/worker, checks persisted content and indexing, reruns migrations, validates recovered records, and recreates matching containers. It then uses the production Caddy configuration with a temporary internal certificate, checks HTTPS cookies/origin rejection/SSE, and drives actual browser capture/edit/navigation. Finally it checks non-root IDs, runtime secret-file exclusion and DB-down readiness. It removes only its generated fixture project/volumes.

The build context excludes local data and credentials and does not depend on the host's `.next` or `node_modules`. This rehearses fresh images/volumes from the current working tree, not a committed clean checkout. The existing uncommitted work was preserved.

The database checks passed 25 cases including fresh/upgrade/checksum migrations, worker interruption, practice invariants and a real PostgreSQL/attachment backup restored into another fresh database. After adding provider admission and embedding-alias regressions, all 16 focused worker/OpenRouter cases passed. All 14 production HTTP privacy/workflow cases passed. Typecheck, lint, local production build, final Docker builds, combined Compose validation and whitespace checks passed.

Final `node scripts/release-check.mjs --skip-build` completed successfully using the freshly rebuilt matching images. Both Chromium scenarios passed (desktop 34.8 s, mobile 11.6 s). They exercised real sign-in, folder + creation, exact capture, safe long Markdown/code preview, disabled-AI improvement feedback without draft loss, editing/version persistence, search, graph/review pages, Save As Written chat, modal Escape/focus return and mobile overflow. Automated WCAG A/AA checks found no serious/critical violations on search, graph, review and chat. No page errors remained. The real screenshot in `docs/screenshots/workspace.png` contains only synthetic fixtures.

The rehearsal exposed and fixed low helper-text contrast and a server/browser timezone mismatch in server-rendered note history. History timestamps now render deterministic UTC text without hydration suppression. Non-root image IDs were 1000, files persisted across recreation, private environment/database/vault/backup paths were absent in runtime images, and stopping PostgreSQL returned liveness 200 but readiness 503. Every generated release fixture container/volume was removed after the run.

CI runs lint, types, build, actual-service tests, fresh/upgrade/restore integration, HTTP privacy and the container/browser rehearsal without a live key. A separate manually dispatched `live-ai` workflow uses environment secrets. Local checks do not imply a GitHub Actions run has occurred.

## Live OpenRouter compatibility

`node --import tsx scripts/ai-release-check.ts --live` creates/removes a random `myai_test_live_*` database. Only synthetic connection prompts are transmitted. Credentials are loaded privately and never printed. The installation database and its saved model settings are untouched.

Initial configured models: chat `nvidia/nemotron-3-ultra-550b-a55b:free` passed; the same structured model returned `AI_INVALID_REQUEST`; `nvidia/llama-nemotron-embed-vl-1b-v2:free` returned `AI_PROFILE`; rerank `nvidia/llama-nemotron-rerank-vl-1b-v2:free` passed. The profile error alone does not identify which response-profile field mismatched.

Checking `openai/text-embedding-3-small` exposed a client integration defect: the returned model ID was `text-embedding-3-small`, with valid 1536-dimensional vectors. The client previously required the OpenRouter-prefixed name. An explicit OpenAI response-alias map now accepts that known mapping while retaining the canonical requested profile and rejecting different models, invalid vectors and dimensions. No general model-name guessing or vector truncation was introduced.

At **2026-09-21 13:29:20 UTC**, all four checks passed:

| Task | Model | Result |
| --- | --- | --- |
| Chat | `nvidia/nemotron-3-ultra-550b-a55b:free` | Passed, 5.398 s |
| Strict structured output | `openai/gpt-4.1-mini` | Passed, 1.027 s |
| Embeddings | `openai/text-embedding-3-small` | Passed, 1536 dimensions, 0.749 s |
| Native rerank | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | Passed, 0.952 s |

The alternate structured/embedding IDs were temporary process overrides. The owner's `.env.local` was not changed. Set the tested compatible IDs in your deployment/Settings before expecting all AI features to work. Paid models may incur charges. These connection checks satisfy P05.11; they are not an end-to-end factual accuracy or educational-quality benchmark. See [OpenRouter structured-output requirements](https://openrouter.ai/docs/guides/features/structured-outputs) and [Caddy streaming behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Remaining release boundaries

- A public hostname/host was not supplied. Public DNS, ACME certificate issuance and remote-network browser access still require the deployment operator's acceptance.
- The owner has not selected a license. README, contribution guidance and synthetic examples are prepared; a LICENSE must be chosen before advertising a licensed open-source release.
- Chromium automation and automated accessibility checks are bounded evidence, not a complete screen-reader/cross-browser audit. Live improvement/graph/practice output quality still needs representative source-based evaluation; task compatibility is insufficient to establish perfect retrieval.
- Final CI runs require pushing the reviewed source to a repository. No publishing, deployment to an external host, git reset or commit was performed.

The next session should close the remaining release gates rather than redesigning the working storage/retrieval architecture. See TODO.md for exact unchecked items.
