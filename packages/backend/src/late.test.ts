import knexFactory from 'knex';
import { lateChanges, raisedStore, span } from './late';

const now = new Date('2026-11-04T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe('the late-report alarm', () => {
  it('raises it once for a deployment that sends and has gone quiet for more than 30 minutes', () => {
    const heard = [
      { deployment: 'augur-workbench', receivedAt: ago(31), via: 'sent' as const },
      { deployment: 'augur-staging', receivedAt: ago(10), via: 'sent' as const },
      { deployment: 'augur-airgapped', receivedAt: ago(3000), via: 'file' as const },
    ];
    expect(lateChanges(heard, [], now).late.map(h => h.deployment)).toEqual(['augur-workbench']);
    expect(lateChanges(heard, [{ deployment: 'augur-workbench', lastHeard: ago(31) }], now)).toEqual({ late: [], back: [] });
  });

  it('says when it comes back, and how long it was quiet', () => {
    const heard = [{ deployment: 'augur-workbench', receivedAt: ago(1), via: 'sent' as const }];
    expect(lateChanges(heard, [{ deployment: 'augur-workbench', lastHeard: ago(121) }], now).back).toEqual([{ deployment: 'augur-workbench', quietMinutes: 120 }]);
    expect(span(45)).toBe('45 minutes');
    expect(span(120)).toBe('2 hours');
    expect(span(3 * 24 * 60)).toBe('3 days');
  });

  it('keeps who it was raised for across restarts', async () => {
    const db = knexFactory({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    const raised = await raisedStore(db);
    await raised.raise({ deployment: 'augur-workbench', receivedAt: ago(40), via: 'sent' });
    await raised.raise({ deployment: 'augur-workbench', receivedAt: ago(40), via: 'sent' });
    expect(await (await raisedStore(db)).all()).toEqual([{ deployment: 'augur-workbench', lastHeard: ago(40) }]);
    await raised.clear('augur-workbench');
    expect(await raised.all()).toEqual([]);
    await db.destroy();
  });
});
