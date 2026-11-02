import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import express from 'express';
import Router from 'express-promise-router';
import { checkReport, deploymentOf, REPORT_KEY } from './reports';
import { reportStore } from './report-store';

/**
 * AUGUR's pipeline feed for the portal: where each unit is between dev, preview and production, as
 * im-platform's Pipeline feed workflow publishes it beside the release feed on GitHub's container
 * registry (ghcr.io/<repo>/feed:pipeline). Read with a deployment read key (read:packages), at most
 * once a minute, and served to the portal's own pages at /api/augur/pipeline. It only describes:
 * nothing here acts on AUGUR or GitHub.
 */
const FRESH_MS = 60_000;

const ociParts = (target: string) => {
  const m = /^oci:\/\/([^/]+)\/(.+):([^:/]+)$/.exec(target);
  if (!m) throw new Error(`augur.pipeline is oci://<registry>/<repository>:<tag>, not ${target}.`);
  return { registry: m[1], repository: m[2], tag: m[3] };
};

/** One file of an OCI artifact, as Docker would pull it: a pull token, the manifest, then its one layer. */
export const readOciFile = async (target: string, key?: { user: string; token: string }, fetchImpl: typeof fetch = fetch) => {
  const { registry, repository, tag } = ociParts(target);
  const tokenRes = await fetchImpl(`https://${registry}/token?service=${registry}&scope=repository:${repository}:pull`, {
    headers: key ? { authorization: `Basic ${Buffer.from(`${key.user}:${key.token}`).toString('base64')}` } : {},
  });
  if (!tokenRes.ok) throw new Error(`${registry} refused the read key (${tokenRes.status}).`);
  const { token } = (await tokenRes.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };
  const manifestRes = await fetchImpl(`https://${registry}/v2/${repository}/manifests/${tag}`, {
    headers: { ...auth, accept: 'application/vnd.oci.image.manifest.v1+json' },
  });
  if (!manifestRes.ok) throw new Error(`${repository}:${tag} isn't there (${manifestRes.status}).`);
  const layer = ((await manifestRes.json()) as { layers?: { digest: string }[] }).layers?.[0];
  if (!layer) throw new Error(`${repository}:${tag} has no file in it.`);
  // The blob redirects to storage; fetch drops the token on the way.
  const blobRes = await fetchImpl(`https://${registry}/v2/${repository}/blobs/${layer.digest}`, { headers: auth });
  if (!blobRes.ok) throw new Error(`${repository}:${tag}'s file couldn't be read (${blobRes.status}).`);
  return blobRes.json() as Promise<unknown>;
};

export default createBackendPlugin({
  pluginId: 'augur',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        http: coreServices.httpRouter,
        logger: coreServices.logger,
        database: coreServices.database,
        auth: coreServices.auth,
        catalog: catalogServiceRef,
      },
      async init({ config, http, logger, database, auth, catalog }) {
        const target = config.getOptionalString('augur.pipeline') ?? 'oci://ghcr.io/harry-burton-dev/im-platform/feed:pipeline';
        const user = config.getOptionalString('augur.readKey.user');
        const token = config.getOptionalString('augur.readKey.token');
        const key = user && token ? { user, token } : undefined;
        let last: { at: number; body?: unknown; problem?: string } | undefined;

        const router = Router();
        router.get('/pipeline', async (_req, res) => {
          if (!last || Date.now() - last.at > FRESH_MS) {
            try {
              last = { at: Date.now(), body: await readOciFile(target, key) };
            } catch (err) {
              const problem = (err as Error).message;
              logger.warn(`AUGUR pipeline feed: ${problem}`);
              last = { at: Date.now(), body: last?.body, problem };
            }
          }
          res.json({ ...(last.body ? { pipeline: last.body } : {}), ...(last.problem ? { problem: last.problem } : {}) });
        });

        // What each deployment runs, as it reports it (ADR 0019 in im-platform; src/reports.ts).
        const reports = await reportStore(await database.getClient());
        const deploymentEntity = async (name: string) => {
          const entity = await catalog.getEntityByRef(`resource:default/${name}`, { credentials: await auth.getOwnServiceCredentials() });
          return entity && (entity.spec as { type?: string } | undefined)?.type === 'augur-deployment' ? entity : undefined;
        };

        // A deployment sends its record here, signed: the signature is its credential, so no sign-in is asked
        // for. The portal's own page posts a carried-in file to the same place (?via=file).
        router.post('/reports', express.json({ limit: '256kb' }), async (req, res) => {
          const name = deploymentOf(req.body);
          const entity = name ? await deploymentEntity(name) : undefined;
          if (name && !entity) {
            res.status(404).json({ problem: `The catalog has no AUGUR deployment called ${name}. Add it to org/deployments.yaml.` });
            return;
          }
          const checked = checkReport(req.body, entity?.metadata.annotations?.[REPORT_KEY]);
          if ('problem' in checked) {
            logger.warn(`AUGUR deployment record refused${name ? ` for ${name}` : ''}: ${checked.problem}`);
            res.status(checked.status).json({ problem: checked.problem });
            return;
          }
          const via = req.query.via === 'file' ? 'file' : 'sent';
          if ((await reports.add(checked.report, via)) === 'older') {
            res.status(409).json({ problem: `The portal already holds a record from ${name} sent at the same time or later.` });
            return;
          }
          res.status(202).json({ kept: true, deployment: name, sentAt: checked.report.sentAt });
        });

        /** The newest record a deployment sent, for its card. */
        router.get('/deployments/:name/report', async (req, res) => {
          const entity = await deploymentEntity(req.params.name);
          const keySet = !!entity?.metadata.annotations?.[REPORT_KEY];
          res.json({ keySet, ...((await reports.latest(req.params.name)) ?? {}) });
        });

        http.addAuthPolicy({ path: '/reports', allow: 'unauthenticated' });
        http.use(router);
      },
    });
  },
});
