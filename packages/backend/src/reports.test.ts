import { generateKeyPairSync, sign } from 'node:crypto';
import { checkReport, REPORT_FORMAT } from './reports';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const now = new Date('2026-11-02T12:00:00Z');

const signed = (record: object, signWith = privateKey) => {
  const payload = JSON.stringify(record);
  return { deployment: 'augur-workbench', payload, signature: sign(null, Buffer.from(payload), signWith).toString('base64') };
};
const record = (extra: object = {}) => ({ format: REPORT_FORMAT, deployment: 'augur-workbench', sentAt: '2026-11-02T11:59:00Z', reason: 'daily', ...extra });

describe('AUGUR deployment records', () => {
  it('keeps a record signed with the deployment’s key', () => {
    expect(checkReport(signed(record()), key, now)).toEqual({ report: record() });
  });

  it('refuses a record with no key in the catalog, another key’s signature, or a change after signing', () => {
    expect(checkReport(signed(record()), undefined, now)).toMatchObject({ status: 403, problem: expect.stringContaining('augur.dev/report-key') });
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(checkReport(signed(record(), other), key, now)).toMatchObject({ status: 403 });
    const changed = { ...signed(record()), payload: JSON.stringify(record({ reason: 'upgrade' })) };
    expect(checkReport(changed, key, now)).toMatchObject({ status: 403 });
  });

  it('refuses another deployment’s record, an unknown format, and one too old or from the future', () => {
    expect(checkReport(signed(record({ deployment: 'augur-demo' })), key, now)).toMatchObject({ status: 400 });
    expect(checkReport(signed(record({ format: 'other/1' })), key, now)).toMatchObject({ status: 400 });
    expect(checkReport(signed(record({ sentAt: '2026-09-01T00:00:00Z' })), key, now)).toMatchObject({ status: 400, problem: expect.stringContaining('30 days') });
    expect(checkReport(signed(record({ sentAt: '2026-11-03T00:00:00Z' })), key, now)).toMatchObject({ status: 400, problem: expect.stringContaining('future') });
    expect(checkReport({ deployment: 'x' }, key, now)).toMatchObject({ status: 400 });
  });
});
