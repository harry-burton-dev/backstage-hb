import knexFactory from 'knex';
import { reportStore } from './report-store';
import { REPORT_FORMAT } from './reports';

const record = (sentAt: string) => ({ format: REPORT_FORMAT, deployment: 'augur-workbench', sentAt, reason: 'daily' }) as const;

describe('the portal’s copy of deployment records', () => {
  it('keeps the newest, and refuses one sent at the same time or before it', async () => {
    const db = knexFactory({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    const store = await reportStore(db);
    expect(await store.latest('augur-workbench')).toBeUndefined();
    expect(await store.add(record('2026-11-02T10:00:00.000Z'), 'sent')).toBe('kept');
    expect(await store.add(record('2026-11-02T10:00:00.000Z'), 'file')).toBe('older');
    expect(await store.add(record('2026-11-02T11:00:00.000Z'), 'file')).toBe('kept');
    expect(await store.latest('augur-workbench')).toMatchObject({ via: 'file', report: { sentAt: '2026-11-02T11:00:00.000Z' } });
    await db.destroy();
  });
});
