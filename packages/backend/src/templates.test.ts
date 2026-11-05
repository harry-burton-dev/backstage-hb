/*
 * The software templates under templates/ (Create in the portal): each is a valid Template, uses only
 * actions this backend loads, and the New AUGUR app template keeps AUGUR's rule for app ids.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { templateEntityV1beta3Validator } from '@backstage/plugin-scaffolder-common';
import { parse } from 'yaml';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

// The built-in actions plus the GitHub module's (packages/backend/src/index.ts).
const LOADED = /^(fetch|catalog|debug):|^(publish:github|github:actions:dispatch)$/;

describe('New AUGUR app template', () => {
  const template = parse(read('templates/augur-app/template.yaml'));

  it('is a valid Template', async () => {
    expect(await templateEntityV1beta3Validator.check(template)).toBe(true);
  });

  it('uses only actions the backend loads', () => {
    for (const step of template.spec.steps) expect(step.action).toMatch(LOADED);
  });

  it('asks for an id the registry would take, and names the app with the template’s own workflow', () => {
    // The registry's rule (augur platform/services/registry/src/manifest.ts) and make-app.mjs's.
    expect(template.spec.parameters[0].properties.id.pattern).toBe('^[a-z][a-z0-9-]{1,39}$');
    const name = template.spec.steps.find((s: { id: string }) => s.id === 'name');
    expect(name.input).toMatchObject({ workflowId: 'name-app.yml', workflowInputs: { id: '${{ parameters.id }}', name: '${{ parameters.name }}' } });
  });

  it('is registered in the catalog, here and on the server', () => {
    expect(read('app-config.yaml')).toContain('../../templates/augur-app/template.yaml');
    expect(read('app-config.production.yaml')).toContain('./templates/augur-app/template.yaml');
    expect(read('Dockerfile')).toContain('COPY --chown=node:node templates ./templates');
  });
});
