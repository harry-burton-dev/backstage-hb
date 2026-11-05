import { useEffect, useState } from 'react';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { useEntity } from '@backstage/plugin-catalog-react';
import { InfoCard, Link, Progress, WarningPanel } from '@backstage/core-components';
import type { Entity } from '@backstage/catalog-model';
import { Typography } from '@material-ui/core';

/**
 * Where AUGUR's units are between dev, preview and production, from AUGUR's pipeline feed
 * (packages/backend/src/augur.ts). Like AUGUR's own Upgrade Centre, these cards show and link, and
 * never act: merging and promoting stay in GitHub.
 */
type Branch = 'dev' | 'preview' | 'production';
const BRANCHES: Branch[] = ['dev', 'preview', 'production'];
const branchWord: Record<Branch, string> = { dev: 'Dev', preview: 'Preview', production: 'Production' };

interface Pull {
  number: number;
  title: string;
  url: string;
}
interface Unit {
  id: string;
  name: string;
  versions: Record<Branch, string | null>;
  devBuild?: { version: string; released?: string };
  waiting: string[];
}
interface Pipeline {
  generatedAt: string;
  repository: string;
  units: Unit[];
  changesets: { id: string; summary: string; units: string[] }[];
  steps: { from: Branch; to: Branch; merged: number }[];
  pulls: { versionPackages?: Pull; promoteToPreview?: Pull; promoteToProduction: (Pull & { unit: string; version: string })[] };
}

const RELEASE_UNIT = 'augur.dev/release-unit';
const RING = 'augur.dev/ring';
const URL_ANNOTATION = 'augur.dev/url';

/** The pipeline's id for a catalog release unit: `augur`, or an app's id for `app/<id>`. */
const unitOf = (entity: Entity) => entity.metadata.annotations?.[RELEASE_UNIT]?.replace(/^app\//, '');

const usePipeline = () => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; pipeline?: Pipeline; problem?: string }>({ loading: true });
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`${await discovery.getBaseUrl('augur')}/pipeline`);
        const body = (await res.json()) as { pipeline?: Pipeline; problem?: string };
        if (!gone) setState({ loading: false, ...body });
      } catch (err) {
        if (!gone) setState({ loading: false, problem: `The portal couldn’t reach its pipeline reader: ${(err as Error).message}` });
      }
    })();
    return () => {
      gone = true;
    };
  }, [discovery, fetch]);
  return state;
};

const Problem = ({ problem, stale }: { problem?: string; stale: boolean }) =>
  problem ? <WarningPanel severity="warning" title={stale ? `${problem} This is from the last read that worked.` : problem} /> : null;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <tr>
    <td style={{ padding: '6px 16px 6px 0', opacity: 0.7, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{label}</td>
    <td style={{ padding: '6px 0' }}>{children}</td>
  </tr>
);

const AsOf = ({ pipeline }: { pipeline: Pipeline }) => (
  <Typography variant="caption" style={{ display: 'block', marginTop: 12, opacity: 0.7 }}>
    From AUGUR’s pipeline feed, as of {new Date(pipeline.generatedAt).toLocaleString()}. Merging and promoting happen in{' '}
    <Link to={`https://github.com/${pipeline.repository}`}>GitHub</Link>.
  </Typography>
);

/** One unit's versions on dev, preview and production, its dev build, and what's waiting to move on. */
function ChannelsCard() {
  const { entity } = useEntity();
  const { loading, pipeline, problem } = usePipeline();
  const id = unitOf(entity);
  const unit = pipeline?.units.find(u => u.id === id);
  const gh = pipeline && `https://github.com/${pipeline.repository}`;
  const promotions = pipeline?.pulls.promoteToProduction.filter(p => p.unit === id || p.unit === unit?.name) ?? [];
  return (
    <InfoCard title="Channels" subheader="Where this is between dev, preview and production">
      {loading ? <Progress /> : null}
      <Problem problem={problem} stale={!!pipeline} />
      {!loading && pipeline && !unit ? (
        <Typography>AUGUR’s pipeline doesn’t list {id ?? 'this'} yet: it appears once it has a version on dev.</Typography>
      ) : null}
      {pipeline && unit ? (
        <>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {BRANCHES.map(b => (
                <Row key={b} label={branchWord[b]}>
                  {unit.versions[b] ?? 'Not there yet'}
                  {b === 'dev' && unit.devBuild ? ` (dev build ${unit.devBuild.version})` : ''}
                </Row>
              ))}
              <Row label="Waiting on dev">
                {unit.waiting.length
                  ? `${unit.waiting.length === 1 ? '1 change' : `${unit.waiting.length} changes`} not in a version yet`
                  : 'Nothing: every change is in a version'}
                {pipeline.pulls.versionPackages ? (
                  <>
                    {' · '}
                    <Link to={pipeline.pulls.versionPackages.url}>Version packages #{pipeline.pulls.versionPackages.number}</Link>
                  </>
                ) : null}
              </Row>
              {pipeline.steps.map(s => (
                <Row key={`${s.from}-${s.to}`} label={`${branchWord[s.from]} → ${branchWord[s.to]}`}>
                  {s.merged ? (
                    <Link to={`${gh}/compare/${s.to}...${s.from}`}>
                      {s.merged === 1 ? '1 pull request' : `${s.merged} pull requests`} {branchWord[s.to]} hasn’t got
                    </Link>
                  ) : (
                    `${branchWord[s.to]} has everything`
                  )}
                  {s.to === 'preview' && pipeline.pulls.promoteToPreview ? (
                    <>
                      {' · '}
                      <Link to={pipeline.pulls.promoteToPreview.url}>Promote to preview #{pipeline.pulls.promoteToPreview.number}</Link>
                    </>
                  ) : null}
                  {s.to === 'production'
                    ? promotions.map(p => (
                        <span key={p.number}>
                          {' · '}
                          <Link to={p.url}>
                            Promote {p.version} #{p.number}
                          </Link>
                        </span>
                      ))
                    : null}
                </Row>
              ))}
            </tbody>
          </table>
          <AsOf pipeline={pipeline} />
        </>
      ) : null}
    </InfoCard>
  );
}

/** The branch a deployment's ring takes its versions from. */
const branchOfRing = (ring?: string): Branch | undefined => (ring === 'dev' || ring === 'preview' || ring === 'production' ? ring : undefined);

/** What a deployment last reported it runs (ADR 0019 in augur; packages/backend/src/reports.ts). */
interface ReportedUnit {
  unit: string;
  name: string;
  running: string;
  available?: string;
  halted?: { reason: string };
  policy?: string;
  open?: { version?: string; state: string };
  lastResult?: { state: string; version?: string; from?: string; finishedAt: string; message?: string };
}
interface ReportView {
  keySet: boolean;
  receivedAt?: string;
  via?: 'sent' | 'file';
  report?: {
    sentAt: string;
    reason: string;
    ring?: string;
    health?: { healthy: boolean; status: string };
    units?: ReportedUnit[];
    feed?: { state: string; checkedAt?: string };
  };
}

/** A deployment reports once a day, so a record older than this is late. */
const LATE_MS = 36 * 3600_000;

const useReport = (name: string) => {
  const discovery = useApi(discoveryApiRef);
  const { fetch } = useApi(fetchApiRef);
  const [state, setState] = useState<{ loading: boolean; reported?: ReportView; problem?: string }>({ loading: true });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`${await discovery.getBaseUrl('augur')}/deployments/${encodeURIComponent(name)}/report`);
        const reported = (await res.json()) as ReportView;
        if (!gone) setState({ loading: false, reported });
      } catch (err) {
        if (!gone) setState({ loading: false, problem: `The portal couldn’t read what this deployment reported: ${(err as Error).message}` });
      }
    })();
    return () => {
      gone = true;
    };
  }, [discovery, fetch, name, again]);
  /** Carries in a record exported from an air-gapped deployment's Upgrade Centre. */
  const carryIn = async (file: File) => {
    const res = await fetch(`${await discovery.getBaseUrl('augur')}/reports?via=file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await file.text(),
    });
    const body = (await res.json().catch(() => ({}))) as { problem?: string };
    if (!res.ok) throw new Error(body.problem ?? `The portal refused the file (${res.status}).`);
    setAgain(n => n + 1);
  };
  return { ...state, carryIn };
};

const resultWord: Record<string, string> = { done: 'went in', 'rolled-back': 'went back by itself', failed: 'didn’t finish', cancelled: 'was cancelled' };

const unitLine = (u: ReportedUnit) => {
  const parts = [u.running];
  if (u.open) parts.push(`upgrading${u.open.version ? ` to ${u.open.version}` : ''}`);
  else if (u.available) parts.push(`${u.available} available`);
  if (u.halted) parts.push(`halted by its publisher: ${u.halted.reason}`);
  if (u.lastResult) parts.push(`last: ${u.lastResult.version ?? ''} ${resultWord[u.lastResult.state] ?? u.lastResult.state} ${new Date(u.lastResult.finishedAt).toLocaleDateString()}`.replace(/ +/g, ' '));
  return parts.join(' · ');
};

/** What the deployment runs, from its last signed record, and a way to carry in an exported one. */
function ReportedRuns({ name }: { name: string }) {
  const { loading, reported, problem, carryIn } = useReport(name);
  const [fileProblem, setFileProblem] = useState<string>();
  const report = reported?.report;
  const late = report && Date.now() - Date.parse(report.sentAt) > LATE_MS;
  return (
    <>
      <Typography variant="subtitle2" style={{ marginTop: 16 }}>
        What it runs
      </Typography>
      {loading ? <Progress /> : null}
      <Problem problem={problem} stale={false} />
      {reported && !reported.keySet ? (
        <Typography paragraph>
          The portal can’t take its reports yet: its public key isn’t in the catalog. Copy it from its Upgrade Centre (Reporting) into the
          annotation augur.dev/report-key in org/deployments.yaml.
        </Typography>
      ) : null}
      {reported?.keySet && !report ? (
        <Typography paragraph>
          It hasn’t reported yet. It sends a record once a day and after every upgrade, when its .env sets PORTAL_URL and DEPLOYMENT_ID; an
          air-gapped one exports a file from its Upgrade Centre for you to carry in below.
        </Typography>
      ) : null}
      {report ? (
        <>
          {late ? <WarningPanel severity="warning" title={`Its last report is from ${new Date(report.sentAt).toLocaleString()}: it reports daily, so check that it’s up and can reach the portal.`} /> : null}
          {report.health && !report.health.healthy ? <WarningPanel severity="error" title={`It reported a problem: ${report.health.status}`} /> : null}
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {(report.units ?? []).map(u => (
                <Row key={u.unit} label={u.name}>
                  {unitLine(u)}
                </Row>
              ))}
            </tbody>
          </table>
          <Typography variant="caption" style={{ display: 'block', marginTop: 8, opacity: 0.7 }}>
            {reported?.via === 'file' ? 'Carried in from a file' : 'Reported by the deployment'}, signed with its key, as of {new Date(report.sentAt).toLocaleString()}.
          </Typography>
        </>
      ) : null}
      {reported?.keySet ? (
        <Typography variant="caption" component="label" style={{ display: 'block', marginTop: 8 }}>
          Carry in an exported record:{' '}
          <input
            type="file"
            accept="application/json,.json"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) carryIn(file).then(() => setFileProblem(undefined), err => setFileProblem((err as Error).message));
            }}
          />
        </Typography>
      ) : null}
      {fileProblem ? <WarningPanel severity="error" title={fileProblem} /> : null}
    </>
  );
}

/**
 * One AUGUR deployment: the versions its ring takes, what it last reported it runs, and a link to its
 * Upgrade Centre. The portal never asks a deployment anything: the deployment sends its signed record.
 */
function DeploymentCard() {
  const { entity } = useEntity();
  const { loading, pipeline, problem } = usePipeline();
  const ring = entity.metadata.annotations?.[RING];
  const url = entity.metadata.annotations?.[URL_ANNOTATION]?.replace(/\/$/, '');
  const branch = branchOfRing(ring);
  return (
    <InfoCard
      title="Deployment"
      subheader={branch ? `On the ${ring} ring: it takes what’s on ${branchWord[branch]}` : 'Its ring isn’t set (annotation augur.dev/ring)'}
      deepLink={url ? { title: 'Open its Upgrade Centre', link: `${url}/admin/updates` } : undefined}
    >
      {loading ? <Progress /> : null}
      <Problem problem={problem} stale={!!pipeline} />
      {!url ? <Typography paragraph>It isn’t running anywhere yet, so there’s no Upgrade Centre to open.</Typography> : null}
      {pipeline && branch ? (
        <>
          <Typography variant="subtitle2">What its ring takes</Typography>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {pipeline.units.map(u => (
                <Row key={u.id} label={u.name}>
                  {branch === 'dev' && u.devBuild ? `${u.devBuild.version} (dev build)` : u.versions[branch] ?? `Not on ${branchWord[branch]} yet`}
                </Row>
              ))}
            </tbody>
          </table>
          <AsOf pipeline={pipeline} />
        </>
      ) : null}
      <ReportedRuns name={entity.metadata.name} />
    </InfoCard>
  );
}

export const channelsCard = EntityCardBlueprint.make({
  name: 'augur-channels',
  params: {
    filter: (entity: Entity) => entity.kind === 'System' && !!entity.metadata.annotations?.[RELEASE_UNIT],
    loader: async () => <ChannelsCard />,
  },
});

export const deploymentCard = EntityCardBlueprint.make({
  name: 'augur-deployment',
  params: {
    filter: (entity: Entity) => entity.kind === 'Resource' && (entity.spec as { type?: string } | undefined)?.type === 'augur-deployment',
    loader: async () => <DeploymentCard />,
  },
});
