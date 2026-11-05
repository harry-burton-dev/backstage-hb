# Backstage

The company's developer portal: one [Backstage](https://backstage.io) above every product and every deployment. It reads each product's catalog from its repository, so nothing in it is kept up by hand. Today that's AUGUR, which writes its catalog with `pnpm catalog` (augur, `docs/catalog.md`).

| What | Where |
| --- | --- |
| Catalog | AUGUR's platform, apps, APIs and resources, read from augur's `main` branch; the company's people in `org/org.yaml` |
| Docs | AUGUR's `docs/` as one TechDocs site, on the AUGUR platform system, built inside the portal by MkDocs |
| APIs | AUGUR's OpenAPI contracts, and each app's intents |
| Sign-in | Keycloak: the workbench AUGUR's realm, as the `backstage` client |
| Channels | Each AUGUR unit's version on dev, preview and production, its dev build, and what's waiting to move on: a card on its system, from AUGUR's pipeline feed (`packages/backend/src/augur.ts`) |
| Deployments | Each AUGUR deployment in `org/deployments.yaml`: its ring, the versions that ring takes, what it last reported it runs, and a link to its Upgrade Centre |
| Look | AUGUR's colours and type (`packages/app/src/modules/augur/theme.ts`) |

AUGUR never depends on the portal: no AUGUR service calls it, and it never writes to AUGUR. If it's down, nothing on any AUGUR server changes.

## Run it

On the server, beside the workbench AUGUR. It's a compose project of its own (`backstage`), with its own Postgres and its own name on the tailnet. It needs about 2 GB of memory.

1. **Get the files.** Clone this repository on the server (or copy `deploy/` across), then:
   ```sh
   cd deploy
   cp .env.example .env && chmod 600 .env
   ```
2. **Tailscale.** Make an auth key in the Tailscale admin console (Settings → Keys, reusable off, tagged as you tag servers) and put it in `TS_AUTHKEY`. `BACKSTAGE_URL` is `https://backstage.<your tailnet>.ts.net` (the same tailnet name as AUGUR's address).
3. **Secrets.** `openssl rand -hex 24` for `POSTGRES_PASSWORD`, and again for `AUTH_SESSION_SECRET`.
4. **GitHub.** `GITHUB_TOKEN` is a read-only token with Contents read on augur. The one AUGUR's Upgrade Centre uses (`infra/deploy/secrets/release-feed-token`) does. For the channels and deployment cards, `GITHUB_READ_USER` and `GITHUB_READ_KEY` are a GitHub user and a classic token with read:packages, the same kind of key an AUGUR server pulls with. Without them the cards say the feed can't be read; everything else works.
5. **Sign-in.** Make the `backstage` client in AUGUR's Keycloak, with AUGUR's folder (where its `.env` is) and the portal's address:
   ```sh
   ./keycloak-client.sh /path/to/augur/infra/deploy https://backstage.<your tailnet>.ts.net
   ```
   It prints `OIDC_CLIENT_SECRET=…`: put that in `.env`. `OIDC_METADATA_URL` is AUGUR's `PLATFORM_URL` followed by `/sso/realms/platform/.well-known/openid-configuration`.
6. **Start it:**
   ```sh
   docker compose pull && docker compose up -d
   docker compose logs -f backstage     # "Listening on :7007" when it's ready
   ```
   The server is already signed in to ghcr.io for AUGUR's images; the portal's image is in the same place.
7. Open `BACKSTAGE_URL` and choose **AUGUR sign-in**. You sign in with your AUGUR account.

The portal joins the tailnet as a real interface (`/dev/net/tun`), not in userspace as AUGUR's sidecar does, because it calls AUGUR's Keycloak over the tailnet when it signs you in.

## Git Release Manager

**Git Release Manager** in the sidebar (`/git-release-manager`) makes release candidates, patches them and promotes them to releases, as GitHub releases and tags on a repository you pick. It acts as you: the first time, it asks you to sign in to GitHub and allow the `repo` scope.

That sign-in needs a GitHub OAuth app (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App):

- Homepage URL: `BACKSTAGE_URL`
- Authorization callback URL: `BACKSTAGE_URL/api/auth/github/handler/frame`

Put its client ID and a new client secret in `.env` as `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, then `docker compose up -d`. Until they're set the page is there but can't sign in to GitHub.

## Upgrade it

Each push to `main` builds `ghcr.io/harry-burton-dev/backstage-hb:latest` and `:<commit>`. On the server: `docker compose pull && docker compose up -d`. To hold a version, set `BACKSTAGE_VERSION=<commit>` in `.env`.

Backstage releases every month. `yarn backstage-cli versions:bump` moves every `@backstage/*` package to the newest release; open it as a pull request and let CI build it.

## Develop it

```sh
yarn install
GITHUB_TOKEN=<read-only token> yarn start     # http://localhost:3000, signed in as a guest
```

Locally you're a guest, and TechDocs builds in Docker. Put anything only for your machine in `app-config.local.yaml` (it's ignored).

## Adding a deployment

Add a `Resource` of type `augur-deployment` to `org/deployments.yaml`, with `augur.dev/ring` (its `SERVER_RING`) and `augur.dev/url` (its `PLATFORM_URL`). Its `metadata.name` is its `DEPLOYMENT_ID`. Check the workbench's address matches its `PLATFORM_URL`.

### What it runs

The portal never asks a deployment anything. Each deployment's registry sends a signed record of what it runs (AUGUR and each app's version, what's available, its update policies, health and its last upgrades' results, no personal data) after each change and at least every 15 minutes, to `<PORTAL_URL>/api/augur/reports` (ADRs 0019 and 0059 in augur). The record's shapes follow OpAMP's. The portal keeps a record only if:

- the deployment is in `org/deployments.yaml`, under the name the record gives;
- its public key is in the annotation `augur.dev/report-key`, copied from its Upgrade Centre (Reporting); and
- the signature is that key's, and the record is newer than the one the portal holds and less than 30 days old.

That endpoint needs no sign-in, because the signature is the credential. An air-gapped deployment exports the same record as a file from its Upgrade Centre; carry it across and choose it under **Carry in an exported record** on the deployment's card. The card warns when the last record is more than 36 hours old. The portal keeps each deployment's last 500 records in its database, for bake times and DORA figures later. A run of records that say the same thing keeps only its first and its newest, so the every-15-minutes records don't push history out.

### Late reports

A deployment that sends its records sends one at least every 15 minutes, so the portal raises the alarm when its newest is more than 30 minutes old: the server, AUGUR's registry or the tailnet between them is down, and nothing on that server can say so (ADR 0059 in augur). It checks every 5 minutes and sends one notification per incident, and another when records come again. A deployment whose newest record was carried in as a file is never late, and neither is one that has never sent a heartbeat (an AUGUR release from before ADR 0059 reports once a day).

Who hears, in `deploy/.env`:

- `LATE_REPORTS_NOTIFY`: entity refs, comma separated (`user:default/<name>`, or a group). Empty: everyone in the portal.
- Email: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_FROM` (the relay), then `docker compose up -d`. A notification to someone is emailed to their catalog profile's `email`; one to everyone goes to `ALERT_EMAIL`. Without `SMTP_HOST` notifications stay in the portal (the bell).

### Bake time

`GET <BACKSTAGE_URL>/api/augur/bake?unit=augur&version=0.14.0` says, from those records, how long each deployment has run that version: from its first record running it to its latest one still running it, and whether any record says it went back from it. augur's **Promote to stable** asks it before it makes a release stable (ADR 0018 there): a release must have run on a preview deployment for the bake time with no going back. It needs no sign-in, since it says no more than the records do, and the portal is only on the tailnet. The workflow reaches it through Tailscale (augur docs/release-channels.md says what to set up).

## Adding a product

Have the product write its own catalog (as AUGUR does with `pnpm catalog`) and add its `all.yaml` under `catalog.locations` in both app-config files. Add people and teams to `org/org.yaml`.

## Known gaps

- Links in AUGUR's guides that point outside `docs/` (to a README or a contract) don't resolve in the TechDocs site yet.
- No CI runs or scorecards of AUGUR's own checks yet (phase B2). Each unit's channels are there.
