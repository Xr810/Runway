# ChatGPT subscription source (preview)

Runway can call `https://api.openai.com/v1/responses` directly with a user's authorized
ChatGPT plan. This is **not Runway login**, an API-key purchase, a Codex process, or permission
to read ChatGPT conversation history. Runway retains its LangGraph Agent, bounded JSON
reads/proposals, human confirmation, live grants, revision checks and tenant isolation.

Use only for your own personal self-hosted installation (including your own remote VM).
Open-source licensing is not admission approval for a commercial or multi-user hosted service.
The public preview documentation describes dynamic registration without a prior manual
approval step for this personal flow; eligibility is still determined by actual consent and
inference. Paid/hosted integrations use OpenAI's separate interest process.

## Prerequisites

- Node.js ≥22.13, a checkout of Runway and `npm ci` on the browser computer and import host.
- `AI_MODE=personal`, the intended account's `ai_enabled=true`, a migrated application database,
  and an independent random `AI_SETTINGS_KEY` of at least 32 characters on the import host.
- HTTPS for Runway itself. OAuth uses an HTTP **loopback-only** listener on `127.0.0.1`, with
  `/auth/callback` and an available ephemeral port, as required by OpenAI. No public callback.
- One authorized ChatGPT registration per Runway account in this initial implementation.
  Different Runway users never share credentials. To change ChatGPT account/workspace,
  explicitly disconnect first. Do not import one person's authorization for other users.

## Local installation

In the repository on your browser computer, create `.env.chatgpt.local` with an independently
generated random `RUNWAY_CHATGPT_TRANSFER_KEY` (at least 32 characters; use 32 random bytes
encoded as hex). Restrict that environment file to owner-only access. Do not reuse the deployment
encryption key, put the secret in shell command arguments, or publish it. For example, generate
the environment file without printing its contents:

```sh
umask 077
node -e 'require("fs").writeFileSync(".env.chatgpt.local", "RUNWAY_CHATGPT_TRANSFER_KEY="+require("crypto").randomBytes(32).toString("hex")+"\n", {flag:"wx",mode:0o600})'
node --env-file=.env.chatgpt.local --import tsx scripts/chatgpt.ts authorize --out data/chatgpt-credentials.json
```

The command opens the system browser with **Continue with ChatGPT**. It requests identity
(`openid profile email`) and plan authorization (`offline_access resource.invoke
chatgpt.tokens.use.direct`). Registration uses `dynamic_agent_client`, PKCE S256, random
state and nonce; code exchange uses the issued client ID, exact callback and API resource.
The ID token is signature-verified against OpenAI JWKS and checked for issuer, audience,
expiry, nonce and subject before credentials are saved. Rejected/incomplete consent does not
enable inference. Neither tokens nor returning authorization URLs are printed.

Find your Runway account UUID under Settings → AI model → local authorization instructions.
Import using the **application's** database and encryption environment:

```sh
node --env-file=.env.local --env-file=.env.chatgpt.local --import tsx scripts/chatgpt.ts import --file data/chatgpt-credentials.json --user YOUR_RUNWAY_ACCOUNT_UUID
```

Import is an explicit administrative/local operation, not a browser token-upload endpoint.
The file uses AES-256-GCM with the separate transfer key, atomic replacement and Unix `0600`.
The import verifies identity again and requires a fresh, unexpired authorization. It seals
credentials with the server encryption key, binds them to the Runway owner, and stores them in
account-isolated `meta`. Ordinary backups/Agent contexts do not include these credentials.

Refresh connection status in settings, read the account-specific model catalog, save a listed
model and run the JSON protocol test. Explicitly select **Use ChatGPT subscription**. Merely
importing does not change the active source. Existing API-key settings remain intact.

## Personal remote VM

Before import, prepare the VM's own identifier:

```sh
node --import tsx scripts/chatgpt.ts host
```

`data/chatgpt-host-id` is an opaque persistent UUID URI; mount/preserve this file across
container recreation. `--host-file PATH` overrides it for CLI commands. Each runtime has its
own identifier, reused when it authorizes locally; credential bundles deliberately contain no
host ID, so importing cannot overwrite the VM's identity.

Complete authorization on your browser computer, not through an arbitrary public VM callback.
Transfer the **encrypted** credential file over SSH/SCP to a protected VM directory; provide
the transfer key through a separate trusted secret channel. Use the import command above
on the VM with its own `.env.local`. Import before authorization/ID-token expiry (normally
within one hour); otherwise authorize again. The VM alone owns subsequent refreshes; do
not simultaneously import/use this rotating session on a laptop and VM.

Remove transfer copies and transfer-key files after successful import, or retain one encrypted
offline copy and its key separately if needed for returning authorization:

```sh
node --env-file=.env.chatgpt.local --import tsx scripts/chatgpt.ts authorize --existing data/chatgpt-credentials.json --out data/chatgpt-credentials.json
```

This reuses that registration's issued client ID and validated subject, retained ID-token hint,
and the local host identifier, with fresh PKCE/state/nonce. Reimport the fresh result on the VM.
An offline bundle must never be imported to restart the old rotating session after VM refresh;
use it only as a reauthorization hint. No laptop refresh command exists. Host-specific usage
attribution/revocation for transferred sessions is currently unavailable upstream.

## Runtime, errors and disconnection

- Requests use `store:false`, `stream:true`, developer instructions and full client history;
  omit unsupported ordinary Responses fields. SSE must reach `response.completed` before
  its JSON is usable. Truncated, failed, malformed and oversized streams are rejected.
- Runway's existing business tools use validated JSON envelopes, not hosted Responses tools.
  Read results/repair turns are resubmitted as history. JSON is prompt-requested and schema-
  validated, not an assertion that every model supports native JSON-schema output.
- Only catalog models with `visibility:list` are shown. Text/JSON use is mock-verified;
  image inputs are adapted but their real capability remains model-dependent/unverified.
  No hosted MCP, file search, image generation, Files upload, audio or video capability added.
- Refresh occurs within 60 seconds of access-token expiry, serialized by a per-owner
  PostgreSQL session advisory lock across processes. Replacement access/refresh tokens and
  expiry are stored together. Refresh intent is committed first. A crash/uncertain refresh
  requires reauthorization rather than replaying a potentially consumed token. Credentials
  remain encrypted until explicit deletion; ordinary temporary inference failures retain them.
- Invalid authorization requests stop. Quota errors (including errors arriving after stream
  start) stop; view [ChatGPT Usage](https://chatgpt.com/settings/usage). There is **no silent
  API-key/environment fallback**. Changing to API Key is a distinct, confirmed user action
  and may create separate API charges. ChatGPT app/plan limits are not an independent Runway
  budget and the displayed message does not promise a reset time.
- Disconnect attempts session revocation, then deletes local tokens regardless of network
  outcome. It reports whether OpenAI confirmed revocation. If not, disconnect the app in
  ChatGPT Settings. Local deletion is not proof of remote revocation; it also does not remove
  a registered OAuth client. The selected source remains ChatGPT and unavailable, not API Key.
- Losing `AI_SETTINGS_KEY` requires reauthorization. Database backups plus this key are
  sensitive. Never place tokens in chat, browser storage, logs, checkpoints or repository files.

## Verification and remaining acceptance

Tests use synthetic signed JWTs, mock OAuth/Responses and disposable account-isolated
PostgreSQL. They do not prove actual OpenAI eligibility, real subscription billing, real
model JSON/image quality, or a successful real OAuth round trip. These require the person's
consent on a local browser and subsequent live request. Do not mark issue #45 fully accepted
until those are demonstrated. This preview intentionally does not implement multiple saved
ChatGPT registrations/account picker, hosted-service eligibility or billing ledgers.

Official references (rechecked during implementation):
[overview](https://developers.openai.com/siwc/token-sharing-open-source),
[sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms),
[models](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
