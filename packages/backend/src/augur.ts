import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import Router from 'express-promise-router';

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
      deps: { config: coreServices.rootConfig, http: coreServices.httpRouter, logger: coreServices.logger },
      async init({ config, http, logger }) {
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
        http.use(router);
      },
    });
  },
});
