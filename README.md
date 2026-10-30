# Backstage

The company's developer portal: one [Backstage](https://backstage.io) above every product and every deployment. It reads each product's catalog from its repository, so nothing in it is kept up by hand. Today that's AUGUR, which writes its catalog with `pnpm catalog` (im-platform, `docs/catalog.md`).

The plan: [Backstage for AUGUR](https://claude.ai/artifact/KmiJ5zLexGxG9B4ctBKSzj).

| What | Where |
| --- | --- |
| Catalog | AUGUR's platform, apps, APIs and resources, read from im-platform's `dev` branch; the company's people in `org/org.yaml` |
| Docs | AUGUR's `docs/` as one TechDocs site, on the AUGUR platform system, built inside the portal by MkDocs |
| APIs | AUGUR's OpenAPI contracts, and each app's intents |
| Sign-in | Keycloak: the workbench AUGUR's realm, as the `backstage` client |
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
4. **GitHub.** `GITHUB_TOKEN` is a read-only token with Contents read on im-platform. The one AUGUR's Updates page uses (`infra/deploy/secrets/release-feed-token`) does.
5. **Sign-in.** Make the `backstage` client in AUGUR's Keycloak, with AUGUR's folder (where its `.env` is) and the portal's address:
   ```sh
   ./keycloak-client.sh /path/to/im-platform/infra/deploy https://backstage.<your tailnet>.ts.net
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

## Upgrade it

Each push to `main` builds `ghcr.io/harry-burton-dev/backstage-hb:latest` and `:<commit>`. On the server: `docker compose pull && docker compose up -d`. To hold a version, set `BACKSTAGE_VERSION=<commit>` in `.env`.

Backstage releases every month. `yarn backstage-cli versions:bump` moves every `@backstage/*` package to the newest release; open it as a pull request and let CI build it.

## Develop it

```sh
yarn install
GITHUB_TOKEN=<read-only token> yarn start     # http://localhost:3000, signed in as a guest
```

Locally you're a guest, and TechDocs builds in Docker. Put anything only for your machine in `app-config.local.yaml` (it's ignored).

## Adding a product

Have the product write its own catalog (as AUGUR does with `pnpm catalog`) and add its `all.yaml` under `catalog.locations` in both app-config files. Add people and teams to `org/org.yaml`.

## Known gaps

- Links in AUGUR's guides that point outside `docs/` (to a README or a contract) don't resolve in the TechDocs site yet.
- No live signals yet: CI runs, each unit's version on dev, preview and production, and AUGUR's own checks as scorecards come next (phase B2).
