import type { Knex } from 'knex';
import type { DeploymentReport } from './reports';

/** Each deployment's records, newest last, in the portal's own database. The last KEEP per deployment are kept. */
const TABLE = 'augur_deployment_reports';
const KEEP = 500;

export interface StoredReport {
  report: DeploymentReport;
  receivedAt: string;
  via: 'sent' | 'file';
}

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
    /** Keeps a record unless one sent at the same time or later is already kept, so a copy can't be replayed over a newer one. */
    async add(report: DeploymentReport, via: StoredReport['via'], now = new Date()): Promise<'kept' | 'older'> {
      const newest = await rows(report.deployment).first('sent_at');
      if (newest && newest.sent_at >= report.sentAt) return 'older';
      await db(TABLE).insert({ deployment: report.deployment, sent_at: report.sentAt, received_at: now.toISOString(), via, payload: JSON.stringify(report) });
      const old = await rows(report.deployment).offset(KEEP).pluck('id');
      if (old.length) await db(TABLE).whereIn('id', old).delete();
      return 'kept';
    },
  };
}
