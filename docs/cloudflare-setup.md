# Set up Snapper on Cloudflare

Snapper uses one Cloudflare Worker for the website/API and one SQLite Durable
Object for the live lobby and saved settings. No separate database subscription,
Vercel project, paid domain or player accounts are needed. Deployment has not yet
been performed; the local implementation and emulator are ready.

**Recommended: connect GitHub in Cloudflare's dashboard.** Workers Builds can
build and deploy `main` automatically, with no local Cloudflare login or terminal
commands required. The GitHub deployment connection and Snapper's GitHub owner
sign-in are separate one-time setups. [Cloudflare Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/).

## Free limits

Checked against Cloudflare's documentation on 2026-09-26:

| Resource | Workers Free allowance |
| --- | --- |
| Worker requests | 100,000/day |
| Worker CPU | 10 milliseconds per invocation |
| Durable Object request units | 100,000/day |
| Durable Object compute | 13,000 GB-seconds/day |
| Storage rows read | 5 million/day |
| Storage rows written | 100,000/day |
| SQLite storage | 5 GB across the account |

These are separate account allowances, not numbers of players. Daily Durable
Object allowances reset at midnight UTC. On Free, excess operations fail; they
do not become paid overages. **Keep the account on Workers Free.** A Workers
Paid account does not satisfy this project's no-spend requirement.
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The expected one-hour weekly game should fit these allowances. That is a planning
estimate, not a production measurement. Other apps in the account share limits.
Review usage after the first game; if a limit is exhausted, wait for its reset.

The repository question bank uses private static-asset shards, with no extra
storage service or subscription. The Worker runs first for every request to
block direct downloads of answer keys; public asset requests therefore also
consume Worker request quota. Free-plan quota exhaustion returns an error and
does not bypass this protection. The generated pack uses 650 shards plus 73
index/manifest files, below the 20,000-file Free allowance. Source archives are
not deployed. [Static assets limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Automatic builds also have a Free allowance of **3,000 build minutes per month**,
with one build at a time and a 20-minute timeout per build. Keep Workers Free;
do not enable paid builds. [Build limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

## 1. Choose the account and address

Create or sign in to a [Cloudflare account](https://dash.cloudflare.com/sign-up).
Confirm the Workers subscription is Free. In **Workers & Pages**, find **Your
subdomain** and select the account subdomain you want. With this repository's
Worker name, the game's URL will be:

```text
https://snapper.YOUR-SUBDOMAIN.workers.dev
```

Cloudflare supplies this address for personal/hobby projects; a purchased domain
is unnecessary. [Cloudflare address documentation](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## 2. Connect GitHub and deploy the website

In **Workers & Pages → Create application → Import a repository**, connect your
GitHub account and select `georgecwan/snapper`. Choose a **Worker** application.
The repo already defines the static website, API, Durable Object and migration.

Use these settings:

| Setting | Value |
| --- | --- |
| Worker name | `snapper` (must match `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --env ''` |
| Node version | 24 (the repository includes `.nvmrc`) |
| Builds for non-production branches | Disabled for this single-lobby product |

Select **Save and Deploy**. Cloudflare installs dependencies and handles its
deployment authorization. The first deployment can show the closed lobby before
owner sign-in is configured; that is expected. Subsequent pushes to `main` deploy
automatically once this connection is active.
[Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

For share-image metadata, add `VITE_PUBLIC_HOSTNAME` with the game's hostname
(without `https://`) under **Settings → Builds → Build variables and secrets**.
This is a public build setting; it is not needed for owner authentication.

## 3. Register owner sign-in

In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
Use:

- Application name: `Snapper`
- Homepage URL: the HTTPS game URL above
- Authorization callback URL: that URL followed by
  `/api/snapper/auth/github/callback`
- Device flow: leave disabled; Snapper uses browser sign-in.

Register the app, note its Client ID, and generate a Client Secret. Keep the secret
out of the repository and chat. Snapper immediately checks the signed-in account's
numeric ID and retains no GitHub access token; guests do not sign in to GitHub.
[GitHub OAuth app setup](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).

Obtain the owner's numeric GitHub `id` from their public profile API at
`https://api.github.com/users/YOUR-GITHUB-USERNAME`. Use `id`, not `node_id` or
the username. Do not infer the owner from the repository name.

## 4. Add the runtime settings in Cloudflare

Open **snapper → Settings → Variables and Secrets** and add:

| Name | Type | Value |
| --- | --- | --- |
| `APP_ORIGIN` | Text | Exact HTTPS game origin, without a path |
| `GITHUB_CLIENT_ID` | Text | OAuth app Client ID |
| `OWNER_GITHUB_ID` | Text | Owner's numeric GitHub ID |
| `GITHUB_CLIENT_SECRET` | Secret | OAuth app Client Secret |
| `SESSION_SECRET` | Secret | Unique random value of at least 32 characters |

Generate `SESSION_SECRET` in a password manager. Select **Deploy** to apply the
settings. Do not copy the development key or set `DEV_AUTH` in production.

These are **runtime** settings, separate from the Build variables screen.
The repository sets `keep_vars: true`, so later Git deployments preserve
dashboard-entered text values; Wrangler also preserves secrets. Values explicitly
declared in `wrangler.jsonc`, including `ENVIRONMENT`, remain controlled by the
repository. No per-account edits to source files are required.
[Dashboard secrets](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard),
[Variable persistence](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth).

## 5. Use the game and verify the live setup

Open the deployed address, sign in with the allowed GitHub account, and open the
lobby. Share the same link with friends and approve each join request. Select
teams/settings, start playing, and optionally promote a player to moderator.

Before the first full game, use a second browser/device to verify approval,
answering, scoring and reconnecting. Check that the session closes after its last
player leaves, and that saved settings survive opening a new session. Review
Workers and Durable Object usage in Cloudflare after that first game. These live
checks remain outstanding until deployment; emulator success is not a claim that
real OAuth, cross-country latency or provider quotas have been verified.

The Vercel integration is disabled in `vercel.json`. Cloudflare auto-deployment
starts only after connecting this repository in the Cloudflare dashboard.

## Optional: manual deployment from a development machine

The dashboard flow above needs none of these local commands. For an agent or
developer deploying manually, use Node.js 24 and authorize Wrangler:

```sh
npm ci
npx wrangler login
npx wrangler whoami
npm run typecheck
npm run lint:snapper
npm test
npm run test:integration
```

If multiple accounts are available, set `CLOUDFLARE_ACCOUNT_ID` to the intended
Free account. Use the runtime values/secrets already stored in the dashboard,
then deploy the default production environment:

```sh
VITE_PUBLIC_HOSTNAME=snapper.YOUR-SUBDOMAIN.workers.dev npm run deploy
```

Wrangler provisions the declared SQLite Durable Object. The game stays closed
until owner sign-in succeeds and the owner opens a session. **Never deploy the
`local` environment.**
