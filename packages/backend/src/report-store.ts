import type { Knex } from 'knex';
import type { DeploymentReport } from './reports';

/**
 * Each deployment's records, newest last, in the portal's own database. The last KEEP per deployment are
 * kept. A deployment sends a record at least every 15 minutes (im-platform ADR 0059), mostly the same as
 * the one before: a run of records saying the same thing keeps only its first and its newest, which is
 * all bake time needs, so history isn't pushed out by heartbeats.
 */
const TABLE = 'augur_deployment_reports';
const KEEP = 500;

export interface StoredReport {
  report: DeploymentReport;
  receivedAt: string;
  via: 'sent' | 'file';
}

/** What a record says, apart from when and why it was sent. */
export const sameAs = (a: DeploymentReport, b: DeploymentReport) => {
  const { sentAt: _a, reason: _ra, ...restA } = a;
  const { sentAt: _b, reason: _rb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
};

export async function reportStore(db: Knex) {
  if (!(await db.schema.hasTable(TABLE))) {
    await db.schema.createTable(TABLE, t => {
      t.increments('id');
      t.string('deployment', 63).notNullable().index();
      t.string('sent_at', 40).notNullable();
      t.string('received_at', 40).notNullable();
      t.string('via', 8).notNullable();
      t.text('payload').notNullable();
    });
  }
  const rows = (deployment: string) => db(TABLE).where({ deployment }).orderBy('sent_at', 'desc');
  return {
    /** The newest record a deployment has sent or had carried in. */
    async latest(deployment: string): Promise<StoredReport | undefined> {
      const row = await rows(deployment).first();
      return row ? { report: JSON.parse(row.payload), receivedAt: row.received_at, via: row.via } : undefined;
    },
    /** When the portal last received a record from each deployment, and how it came. */
    async heard(): Promise<{ deployment: string; receivedAt: string; via: StoredReport['via']; heartbeats: boolean }[]> {
      const newest = db(TABLE).select('deployment').max('sent_at as sent_at').groupBy('deployment').as('n');
      const found = await db(TABLE)
        .join(newest, function on() {
          this.on(`${TABLE}.deployment`, '=', 'n.deployment').andOn(`${TABLE}.sent_at`, '=', 'n.sent_at');
        })
        .select(`${TABLE}.deployment as deployment`, `${TABLE}.received_at as received_at`, `${TABLE}.via as via`);
      // Only a deployment that has sent a heartbeat promises one every 15 minutes: an older registry sends daily.
      const beats = new Set<string>(await db(TABLE).where('payload', 'like', '%"reason":"heartbeat"%').distinct().pluck('deployment'));
      return found.map((r: { deployment: string; received_at: string; via: StoredReport['via'] }) => ({ deployment: r.deployment, receivedAt: r.received_at, via: r.via, heartbeats: beats.has(r.deployment) }));
    },
    /** Every kept record, from every deployment, oldest first: what bake time is worked out from. */
    async all(): Promise<DeploymentReport[]> {
      const kept = await db(TABLE).orderBy('sent_at', 'asc').pluck('payload');
      return kept.map((payload: string) => JSON.parse(payload));
    },
    /** Keeps a record unless one sent at the same time or later is already kept, so a copy can't be replayed over a newer one. */
    async add(report: DeploymentReport, via: StoredReport['via'], now = new Date()): Promise<'kept' | 'older'> {
      const [newest, before] = await rows(report.deployment).limit(2).select('id', 'sent_at', 'payload');
      if (newest && newest.sent_at >= report.sentAt) return 'older';
      // The newest is the end of a run saying the same thing: it moves on to this one.
      if (newest && before && sameAs(JSON.parse(newest.payload), report) && sameAs(JSON.parse(before.payload), report)) {
        await db(TABLE).where({ id: newest.id }).update({ sent_at: report.sentAt, received_at: now.toISOString(), via, payload: JSON.stringify(report) });
        return 'kept';
      }
      await db(TABLE).insert({ deployment: report.deployment, sent_at: report.sentAt, received_at: now.toISOString(), via, payload: JSON.stringify(report) });
      const old = await rows(report.deployment).offset(KEEP).pluck('id');
      if (old.length) await db(TABLE).whereIn('id', old).delete();
      return 'kept';
    },
  };
}
