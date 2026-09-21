# P07 implementation — 2026-09-20

P07.01–P07.09 implement explicit chat modes, stable folder slash scope, exact-response atomic saving, durable retry/cancel/history, reviewed fixed-target tools and saved-answer provenance.

`src/lib/storage/chat.ts` owns operation attempts, server history and commit receipts. `chat-tools.ts` validates tool targets and expected versions. `/api/chat` streams operation status and completion; `/api/chat/operations/[id]` exposes recovery. The chat panel supports conversation management, nested folder creation, review/apply changes, source links and Save this answer.

Migration `0005_chat_lifecycle.sql` adds conversation deletion markers. Deletion hides history while retaining saved-note provenance; it is not a secure purge. Run `npm run db:migrate`; Compose runs the migration service before web/worker startup.

Validation passed: seven focused PostgreSQL chat scenarios across initial and targeted runs, the earlier canonical chat regression, 12 storage/migration scenarios and 12 authenticated HTTP/restart scenarios. Build/TypeScript, lint and schema consistency passed during implementation. Browser connection discovery returned no available browser. Live OpenRouter acceptance remains pending credentials/models.

Tools are bounded, owner-directed proposals; they do not run an autonomous tool loop. Interrupted inference can incur another provider charge on retry; database effects are idempotent. P08/P09 implement the retrieval and graph pipeline following this phase.
