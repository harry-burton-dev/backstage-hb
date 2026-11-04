import type { Knex } from 'knex';

/**
 * The dead-man alert (im-platform ADR 0059): a deployment that sends its signed record sends one at least
 * every 15 minutes, so a record more than 30 minutes late means the deployment, its host or the way to the
 * portal is down, and nothing on that host can say so. The portal checks every few minutes and sends a
 * notification (emailed when the portal has SMTP settings), and another when records come again.
 *
 * Only deployments that send heartbeats count: an air-gapped one carries its records in as files, and one
 * on a release from before ADR 0059 sends once a day, so neither is ever "late".
 */
export const LATE_AFTER_MINUTES = 30;

/** When the portal last heard from a deployment. */
export interface Heard {
  deployment: string;
  /** When the portal received its newest record, by the portal's own clock. */
  receivedAt: string;
  via: 'sent' | 'file';
  /** It has sent a heartbeat, so it promises a record every 15 minutes. A registry from before that sends daily. */
  heartbeats: boolean;
}

/** A deployment the portal has raised the alarm for, and when it last heard from it then. */
export interface Raised {
  deployment: string;
  lastHeard: string;
}

export interface Changes {
  /** Newly late: raise the alarm. */
  late: Heard[];
  /** Late before, heard from since: say so, and how long it was quiet. */
  back: { deployment: string; quietMinutes: number }[];
}

/** What changed since the last check: who has gone quiet, and who has come back. */
export function lateChanges(heard: Heard[], raised: Raised[], now: Date, afterMinutes = LATE_AFTER_MINUTES): Changes {
  const limit = afterMinutes * 60_000;
  const alarmed = new Map(raised.map(r => [r.deployment, r]));
  const late: Heard[] = [];
  const back: Changes['back'] = [];
  for (const h of heard) {
    const quiet = now.getTime() - Date.parse(h.receivedAt) > limit;
    const was = alarmed.get(h.deployment);
    if (quiet && !was && h.via === 'sent' && h.heartbeats) late.push(h);
    if (!quiet && was) back.push({ deployment: h.deployment, quietMinutes: Math.round((Date.parse(h.receivedAt) - Date.parse(was.lastHeard)) / 60_000) });
  }
  return { late, back };
}

/** Minutes as a person would say them. */
export const span = (minutes: number) => {
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
};

const TABLE = 'augur_late_reports';

/** Which deployments the alarm is raised for, kept in the portal's database so a restart doesn't raise it twice. */
export async function raisedStore(db: Knex) {
  if (!(await db.schema.hasTable(TABLE))) {
    await db.schema.createTable(TABLE, t => {
      t.string('deployment', 63).primary();
      t.string('last_heard', 40).notNullable();
      t.string('raised_at', 40).notNullable();
    });
  }
  return {
    async all(): Promise<Raised[]> {
      return (await db(TABLE).select('deployment', 'last_heard')).map((r: { deployment: string; last_heard: string }) => ({ deployment: r.deployment, lastHeard: r.last_heard }));
    },
    async raise(h: Heard, now = new Date()) {
      await db(TABLE).insert({ deployment: h.deployment, last_heard: h.receivedAt, raised_at: now.toISOString() }).onConflict('deployment').merge();
    },
    async clear(deployment: string) {
      await db(TABLE).where({ deployment }).delete();
    },
  };
}
