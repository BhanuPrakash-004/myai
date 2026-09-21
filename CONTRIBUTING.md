# Contributing

Read [general.txt](general.txt), [TODO.md](TODO.md) and [AGENTS.md](AGENTS.md) before changing behavior. The installed Next.js guides are the authority for this pinned framework version. Work against synthetic notes and isolated databases.

MyAI has one owner per installation. Canonical Markdown, immutable versions, source evidence and transactional jobs live in PostgreSQL. All mutations go through the knowledge/domain services. Keep expected-version checks, operation idempotency and current-source filtering intact. Ask must remain read-only; partial AI output must never become a completed generated note.

Use Node 22.14+ and Docker Compose v2. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. For persistence changes start `docker compose -f compose.test.yml up -d --wait`, then run the relevant production-service integration test. `npm run test:http` requires a production build. `npm run test:release` builds disposable containers and checks HTTPS plus Chromium desktop/mobile workflows; install Chromium first with `npx playwright install chromium`. CI performs these checks without an API key.

Never edit an applied SQL migration. Add the next numbered migration and update the Drizzle metadata. Explain any data migration, backup requirement and compatibility boundary in the PR. Keep web, worker and maintenance artifacts on the same revision.

No owner content, API keys, authentication cookies, database dumps or real screenshots belong in an issue or fixture. Live OpenRouter checks are explicitly opt-in, use synthetic text and can incur provider charges. Document measured outcomes rather than claiming perfect recall or factual correctness. Update the implementation ledger with what was actually exercised and what remains unverified.

The repository owner's license choice is pending. Do not describe this release as licensed open source or add third-party source without compatible attribution until a LICENSE is selected.
