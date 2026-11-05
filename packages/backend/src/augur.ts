import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import express from 'express';
import Router from 'express-promise-router';
import { checkReport, deploymentOf, REPORT_KEY } from './reports';
import { reportStore } from './report-store';
import { bakeOf } from './bake';
import { notificationService } from '@backstage/plugin-notifications-node';
import { LATE_AFTER_MINUTES, lateChanges, raisedStore, span } from './late';

/**
 * AUGUR's pipeline feed for the portal: where each unit is between dev, preview and production, as
 * augur's Pipeline feed workflow publishes it beside the release feed on GitHub's container
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
        scheduler: coreServices.scheduler,
        notifications: notificationService,
      },
      async init({ config, http, logger, database, auth, catalog, scheduler, notifications }) {
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

        // What each deployment runs, as it reports it (ADR 0019 in augur; src/reports.ts).
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

        /**
         * How long a release has run on each deployment, for augur's Promote to stable (ADR 0018). It
         * needs no sign-in: it says only which versions ran where and for how long, which the deployments'
         * own records already say, and the portal is reached only on the tailnet.
         */
        router.get('/bake', async (req, res) => {
          const unit = typeof req.query.unit === 'string' ? req.query.unit : '';
          const version = typeof req.query.version === 'string' ? req.query.version : '';
          if (!/^[a-z][a-z0-9-]*$/.test(unit) || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
            res.status(400).json({ problem: 'Ask for ?unit=<augur or an app id>&version=<x.y.z>.' });
            return;
          }
          res.json({ unit, version, deployments: bakeOf(await reports.all(), unit, version) });
        });

        // The dead-man alert (ADR 0059 in augur; src/late.ts): who hears when a deployment goes quiet.
        // augur.lateReports.notify lists entity refs, comma separated (user:default/<name> or a group, emailed
        // at their profile's email). Without it the notification goes to everyone in the portal, and is
        // emailed to the broadcast address (app-config.email.yaml).
        const notify = (config.getOptionalString('augur.lateReports.notify') ?? '').split(',').map(r => r.trim()).filter(Boolean);
        const afterMinutes = config.getOptionalNumber('augur.lateReports.afterMinutes') ?? LATE_AFTER_MINUTES;
        const raised = await raisedStore(await database.getClient());
        const recipients = notify.length ? ({ type: 'entity', entityRef: notify } as const) : ({ type: 'broadcast' } as const);
        await scheduler.scheduleTask({
          id: 'augur-late-reports',
          frequency: { minutes: 5 },
          timeout: { minutes: 2 },
          initialDelay: { minutes: 5 },
          fn: async () => {
            const now = new Date();
            const { late, back } = lateChanges(await reports.heard(), await raised.all(), now, afterMinutes);
            for (const h of late) {
              const quiet = span(Math.round((now.getTime() - Date.parse(h.receivedAt)) / 60_000));
              await notifications.send({
                recipients,
                payload: {
                  title: `${h.deployment} has gone quiet`,
                  description: `No record from ${h.deployment} for ${quiet}; it sends one at least every 15 minutes. The server, AUGUR's registry or the way to this portal may be down. Its Grafana can't say so if the whole host is down.`,
                  link: `/catalog/default/resource/${h.deployment}`,
                  severity: 'critical',
                  topic: 'augur-late-report',
                  scope: `augur-late-report:${h.deployment}`,
                },
              });
              await raised.raise(h, now);
              logger.warn(`AUGUR deployment ${h.deployment} is late: last record received ${h.receivedAt}.`);
            }
            for (const b of back) {
              await notifications.send({
                recipients,
                payload: {
                  title: `${b.deployment} is reporting again`,
                  description: `Records from ${b.deployment} came again after ${span(b.quietMinutes)} without one.`,
                  link: `/catalog/default/resource/${b.deployment}`,
                  severity: 'normal',
                  topic: 'augur-late-report',
                  scope: `augur-late-report:${b.deployment}`,
                },
              });
              await raised.clear(b.deployment);
              logger.info(`AUGUR deployment ${b.deployment} is reporting again.`);
            }
          },
        });

        http.addAuthPolicy({ path: '/reports', allow: 'unauthenticated' });
        http.addAuthPolicy({ path: '/bake', allow: 'unauthenticated' });
        http.use(router);
      },
    });
  },
});
