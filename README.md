# Snapper

A shared trivia game for friends, inspired by Reach for the Top and Protobowl.
One owner opens the lobby and approves guests. Up to 16 players and 16 spectators
can join; games support free-for-all or two teams and eight text question formats.

## Project context

- [Product design](docs/product-design.md): the approved rules and requirements.
- [Implementation guide](docs/implementation.md): code map, content, checks and deployment setup.
- [Cloudflare setup](docs/cloudflare-setup.md): account, free limits, owner sign-in and deployment steps.
- [Repository question bank](data/README.md): 77,947 imported questions, source licenses, quality limits and offline maintenance.
- [Architecture audit](docs/architecture-audit.md): historical prototype findings and hosting research.
- [Agent instructions](AGENTS.project.md): constraints future coding sessions must preserve.

## Develop and verify

```sh
npm ci
npm run dev
npm run typecheck
npm run lint:snapper
npm test
npm run questions:check
npm run test:integration
npm run build
npm run check:worker
npm run preview:restart
```

Use Node.js 24 (`.nvmrc`). Development runs on port 8080 with a local Cloudflare emulator. The loopback-only
owner button allows local testing without GitHub credentials. The production
preview runs on 8081. `startup.sh` restarts development after a stopped session.

`npm run check:browser` verifies desktop and mobile rendering and saves screenshots.
On macOS it uses installed Chrome; elsewhere it uses Playwright Chromium.
`npm run build:brand` regenerates app icons and share images from the SVG sources.

The active stack is static React/Vite plus a Cloudflare Worker and one SQLite
Durable Object. The server owns timing, buzzing, judging, roles and private
question content. The old Lectern/TanStack Start modules remain as legacy
references and are not the Snapper runtime. Legacy template checks remain
available under `npm run test:template`.

## Deploy

Production deployment has not been performed. It requires a **Cloudflare Workers
Free** account and a GitHub OAuth application restricted to the owner's numeric
GitHub ID. Use only the Free plan with enforced quotas; never enable paid overages
or deploy the local development environment. Follow the configuration and secret
setup in [the implementation guide](docs/implementation.md) before deployment.
Connect this repository to **Cloudflare Workers Builds** for automatic deployment
on pushes to `main`; the setup guide lists the exact dashboard settings. Runtime
variables and secrets can be entered once in Cloudflare's dashboard and survive
later deployments. No Cloudflare Git connection has been configured by this agent.
Automatic Vercel Git deployments are disabled because Vercel is no longer the target.
