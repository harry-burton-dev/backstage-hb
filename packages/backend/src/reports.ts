import { createPublicKey, verify } from 'node:crypto';

/**
 * What an AUGUR deployment reports it runs (augur ADR 0019): its registry sends a signed record
 * after every upgrade and once a day, or an admin exports it as a file and carries it across. The portal
 * keeps a record only when the deployment is in the catalog (org/deployments.yaml) with its public key
 * in the augur.dev/report-key annotation, and the signature is that key's.
 */
export const REPORT_FORMAT = 'augur.deployment-report/1';
export const REPORT_KEY = 'augur.dev/report-key';
/** A record may wait this long in a file before it's carried in. */
const OLDEST_MS = 30 * 24 * 3600_000;
/** Clocks differ a little. */
const AHEAD_MS = 5 * 60_000;

/** What a deployment sends, and what an exported file holds: the record as it was signed, and the signature. */
export interface SignedReport {
  deployment: string;
  payload: string;
  signature: string;
}

/** The record, after its signature is checked. Its shapes follow OpAMP's (agent description, health, package statuses). */
export interface DeploymentReport {
  format: typeof REPORT_FORMAT;
  deployment: string;
  sentAt: string;
  reason: string;
  [key: string]: unknown;
}

export type Checked = { report: DeploymentReport } | { status: number; problem: string };

const isSigned = (body: unknown): body is SignedReport => {
  const b = body as Partial<SignedReport> | null;
  return !!b && typeof b.deployment === 'string' && typeof b.payload === 'string' && typeof b.signature === 'string';
};

export const DEPLOYMENT_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The deployment a body names, when it looks like a signed record at all. */
export const deploymentOf = (body: unknown) => (isSigned(body) && DEPLOYMENT_NAME.test(body.deployment) ? body.deployment : undefined);

/** Checks a signed record against the deployment's public key (base64 SPKI, as AUGUR's Upgrade Centre shows it). */
export function checkReport(body: unknown, publicKey: string | undefined, now = new Date()): Checked {
  if (!isSigned(body)) return { status: 400, problem: 'That isn’t a signed AUGUR deployment record: it needs deployment, payload and signature.' };
  if (!publicKey) {
    return { status: 403, problem: `The catalog has no ${REPORT_KEY} annotation for ${body.deployment}, so its records can’t be checked. Copy the key from its Upgrade Centre into org/deployments.yaml.` };
  }
  let ok = false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    ok = verify(null, Buffer.from(body.payload, 'utf8'), key, Buffer.from(body.signature, 'base64'));
  } catch {
    return { status: 403, problem: `The ${REPORT_KEY} annotation for ${body.deployment} isn’t an Ed25519 public key.` };
  }
  if (!ok) return { status: 403, problem: `The signature isn’t ${body.deployment}’s: it was signed with another key, or changed after it was signed.` };
  let report: DeploymentReport;
  try {
    report = JSON.parse(body.payload);
  } catch {
    return { status: 400, problem: 'The signed record isn’t JSON.' };
  }
  if (report?.format !== REPORT_FORMAT) return { status: 400, problem: `The record is in a format the portal doesn’t read (${String(report?.format)}); it reads ${REPORT_FORMAT}.` };
  if (report.deployment !== body.deployment) return { status: 400, problem: `The record is ${String(report.deployment)}’s, not ${body.deployment}’s.` };
  const sent = Date.parse(report.sentAt);
  if (Number.isNaN(sent)) return { status: 400, problem: 'The record doesn’t say when it was sent.' };
  if (sent > now.getTime() + AHEAD_MS) return { status: 400, problem: 'The record says it was sent in the future: check the deployment’s clock.' };
  if (sent < now.getTime() - OLDEST_MS) return { status: 400, problem: 'The record is more than 30 days old. Export a new one from the Upgrade Centre.' };
  return { report };
}
