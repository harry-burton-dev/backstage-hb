import type { DeploymentReport } from './reports';

/**
 * How long a release has run on each deployment, from what the deployments report (augur ADR
 * 0018 and 0019): Promote to stable asks this before it makes a release stable. A deployment baked a
 * release from its first record running it to its latest record still running it, as long as no
 * record in between says it went back from it. Records come at least daily, so the time counted is
 * at most a day short.
 */

/** A unit's line in a record, as augur's registry writes it (src/report.ts). */
interface ReportedUnit {
  unit: string;
  running?: string;
  lastResult?: { state: string; from?: string; version?: string };
}

export interface DeploymentBake {
  deployment: string;
  ring?: string;
  /** The first and latest record that showed it running the version. */
  since: string;
  until: string;
  hours: number;
  /** Still running it in its newest record. */
  current: boolean;
  /** A record said it went back from this version. */
  wentBack: boolean;
}

const unitIn = (report: DeploymentReport, unit: string) =>
  (Array.isArray(report.units) ? (report.units as ReportedUnit[]) : []).find(u => u.unit === unit);

/** Each deployment's bake of `unit` at `version`, from its records in any order; deployments that never ran it are left out. */
export function bakeOf(reports: DeploymentReport[], unit: string, version: string): DeploymentBake[] {
  const byDeployment = new Map<string, DeploymentReport[]>();
  for (const r of reports) byDeployment.set(r.deployment, [...(byDeployment.get(r.deployment) ?? []), r]);
  const bakes: DeploymentBake[] = [];
  for (const [deployment, all] of byDeployment) {
    const sorted = [...all].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const running = sorted.filter(r => unitIn(r, unit)?.running === version);
    if (!running.length) continue;
    const first = running[0];
    const last = running[running.length - 1];
    const wentBack = sorted.some(r => {
      const result = unitIn(r, unit)?.lastResult;
      return result?.state === 'rolled-back' && (result.version === version || result.from === version);
    });
    bakes.push({
      deployment,
      ring: typeof sorted[sorted.length - 1].ring === 'string' ? (sorted[sorted.length - 1].ring as string) : undefined,
      since: first.sentAt,
      until: last.sentAt,
      hours: Math.floor((Date.parse(last.sentAt) - Date.parse(first.sentAt)) / 3600_000),
      current: unitIn(sorted[sorted.length - 1], unit)?.running === version,
      wentBack,
    });
  }
  return bakes.sort((a, b) => b.hours - a.hours);
}
