# Security

MyAI is a private single-owner application. Public registration and web password recovery are disabled. Provision or recover the owner through the local maintenance command. Recovery revokes sessions. Use an HTTPS origin for remote access and keep PostgreSQL reachable only on the private Compose network.

Keep `.env`, `.env.local`, Docker environment, attachments and backup bundles private. Bundles contain password hashes, sessions and all historical content; they are not encrypted by MyAI. Use encrypted storage and a separate protected copy of the deployment secrets. Browser drafts are stored on the device; use a trusted browser profile and sign out on shared devices.

OpenRouter receives the text required for enabled AI operations, including retrieved passages. Manual capture and keyword search do not require an API key. Disabling AI indexing does not disable an explicit AI request. Model-generated content and retrieved notes are untrusted input, not instructions granting tool permissions.

Report a vulnerability privately through the repository's **Security → Report a vulnerability** feature if the maintainer has enabled it. If unavailable, request a private contact without disclosing exploit details. Do not attach live credentials or personal data. No public security email or support commitment has been invented for this project.

For upgrades, take and verify a full backup, stop writers, run serialized migrations with matching images, then verify readiness. Roll back by restoring a matching backup into fresh volumes; do not point old code at a newer schema. See [recovery](docs/RECOVERY.md).

Limits: owner authentication, origin checks, bounded bodies, strict import paths, private downloads, safe Markdown and provider budgets reduce risk; they do not make arbitrary model output trustworthy. The bundled proxy is the supported public ingress. Keep the host, Docker and pinned dependencies patched. This repository has not undergone an independent security audit.
