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

  it('keeps only the first and newest of a run of records that say the same thing, and says when each deployment was last heard', async () => {
    const db = knexFactory({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    const store = await reportStore(db);
    const at = (h: number, units = '0.14.0') => ({ ...record(`2026-11-02T1${h}:00:00.000Z`), reason: 'heartbeat', units: [{ unit: 'augur', running: units }] });
    for (const h of [0, 1, 2, 3]) expect(await store.add(at(h), 'sent', new Date(`2026-11-02T1${h}:00:01.000Z`))).toBe('kept');
    expect((await store.all()).map(r => r.sentAt)).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-02T13:00:00.000Z']);
    await store.add(at(4, '0.15.0'), 'sent', new Date('2026-11-02T14:00:01.000Z'));
    expect((await store.all()).map(r => r.sentAt)).toEqual(['2026-11-02T10:00:00.000Z', '2026-11-02T13:00:00.000Z', '2026-11-02T14:00:00.000Z']);
    expect(await store.heard()).toEqual([{ deployment: 'augur-workbench', receivedAt: '2026-11-02T14:00:01.000Z', via: 'sent' }]);
    await db.destroy();
  });
});
