# Set up Snapper on Cloudflare

Snapper uses one Cloudflare Worker for the website/API and one SQLite Durable
Object for the live lobby and saved settings. No separate database subscription,
Vercel project, paid domain or player accounts are needed. Deployment has not yet
been performed; the local implementation and emulator are ready.

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

Authorize the installed deployment tool from the repository:

```sh
npx wrangler login
npx wrangler whoami
```

Sign in and approve Wrangler's authorization in the browser. If multiple accounts
are available, set the intended account's ID as top-level `account_id` in
`wrangler.jsonc`. These commands do not deploy the game.

## 2. Register owner sign-in

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

## 3. Configure production

Update the top-level `vars` in `wrangler.jsonc`, retaining all existing asset,
Durable Object and migration configuration:

```json
"vars": {
  "ENVIRONMENT": "production",
  "APP_ORIGIN": "https://snapper.YOUR-SUBDOMAIN.workers.dev",
  "GITHUB_CLIENT_ID": "YOUR-OAUTH-CLIENT-ID",
  "OWNER_GITHUB_ID": "YOUR-NUMERIC-GITHUB-ID"
}
```

These values are nonsecret. `APP_ORIGIN` must be the exact HTTPS origin, without
a path. Store the two secrets separately with interactive prompts:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET --env ''
npx wrangler secret put SESSION_SECRET --env ''
```

Use the OAuth Client Secret for the first value. Generate a unique random value
of at least 32 characters in a password manager for `SESSION_SECRET`. Never use
the checked-in development key. On first setup Wrangler may offer to create
the named Worker for the secret; check the selected Free account and `snapper`
name before continuing. **Never deploy the `local` environment.**

## 4. Verify and deploy

Using Node.js 24 from `.nvmrc`, install and check the code:

```sh
npm ci
npm run typecheck
npm run lint:snapper
npm test
npm run test:integration
```

Set the public hostname for share metadata and deploy the default production
configuration:

```sh
VITE_PUBLIC_HOSTNAME=snapper.YOUR-SUBDOMAIN.workers.dev npm run deploy
```

Wrangler provisions the declared SQLite Durable Object. The game stays closed
until owner sign-in succeeds and the owner opens a session. Git pushes do not
deploy automatically; the retired Vercel integration is disabled in `vercel.json`.

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
