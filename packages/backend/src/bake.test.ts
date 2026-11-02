import { bakeOf } from './bake';
import { REPORT_FORMAT, type DeploymentReport } from './reports';

const at = (hours: number) => new Date(Date.parse('2026-11-01T00:00:00Z') + hours * 3600_000).toISOString();
const record = (deployment: string, hours: number, running: string, extra: object = {}, ring = 'preview'): DeploymentReport => ({
  format: REPORT_FORMAT,
  deployment,
  sentAt: at(hours),
  reason: 'daily',
  ring,
  units: [{ unit: 'augur', running, ...extra }],
});

describe('bake time', () => {
  it('counts from the first record running a version to the latest still running it, per deployment', () => {
    const bakes = bakeOf(
      [record('augur-preview', 0, '0.13.0'), record('augur-preview', 2, '0.14.0'), record('augur-preview', 26, '0.14.0'), record('augur-preview', 76, '0.14.0'), record('augur-workbench', 10, '0.14.0', {}, 'dev'), record('augur-workbench', 20, '0.15.0', {}, 'dev')],
      'augur',
      '0.14.0',
    );
    expect(bakes).toEqual([
      { deployment: 'augur-preview', ring: 'preview', since: at(2), until: at(76), hours: 74, current: true, wentBack: false },
      { deployment: 'augur-workbench', ring: 'dev', since: at(10), until: at(10), hours: 0, current: false, wentBack: false },
    ]);
  });

  it('says when a deployment went back from it, and leaves out deployments that never ran it', () => {
    const bakes = bakeOf(
      [record('augur-preview', 0, '0.14.0'), record('augur-preview', 30, '0.13.0', { lastResult: { state: 'rolled-back', from: '0.13.0', version: '0.14.0' } }), record('augur-demo', 0, '0.13.0')],
      'augur',
      '0.14.0',
    );
    expect(bakes).toEqual([expect.objectContaining({ deployment: 'augur-preview', wentBack: true, current: false })]);
  });
});
