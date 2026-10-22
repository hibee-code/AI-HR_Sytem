#!/usr/bin/env node
/**
 * Builds a Postman collection from the running API's OpenAPI document, so it
 * never drifts from the code. Adds:
 *   - collection-level Bearer auth using {{accessToken}}
 *   - "0 · Sign in" folder: one login per demo role (saves tokens
 *     automatically), MFA verify, refresh
 *   - an environment file for the demo company (npm run seed:demo)
 *
 *   npm run start:dev            # in another terminal (non-production)
 *   npm run postman              # → postman/*.json
 *   OPENAPI_URL=http://host:3000/api/docs-json BASE_URL=https://hr.example.com npm run postman
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import converter from 'openapi-to-postmanv2';

const OPENAPI_URL =
  process.env.OPENAPI_URL ?? 'http://localhost:3000/api/docs-json';
const BASE_URL = process.env.BASE_URL ?? new URL(OPENAPI_URL).origin;
const OUT = 'postman';

const ROLES = [
  ['Admin', '{{adminEmail}}', '{{adminPassword}}'],
  ['HR manager', 'hr@demo.local', '{{demoPassword}}'],
  ['Line manager (Engineering)', 'eng@demo.local', '{{demoPassword}}'],
  ['Employee', 'dev1@demo.local', '{{demoPassword}}'],
  ['Recruiter', 'rec@demo.local', '{{demoPassword}}'],
];

/** Saves tokens (or the MFA challenge) from a login/verify/refresh response. */
const SAVE_TOKENS = [
  'const body = pm.response.json();',
  'if (body.mfaRequired) {',
  "  pm.collectionVariables.set('mfaToken', body.mfaToken);",
  "  console.log('MFA required: run \"Verify MFA code\" with a code from the authenticator app');",
  '} else if (body.accessToken) {',
  "  pm.collectionVariables.set('accessToken', body.accessToken);",
  "  pm.collectionVariables.set('refreshToken', body.refreshToken);",
  '}',
  "pm.test('signed in', () => pm.expect(pm.response.code).to.eql(200));",
];

const post = (name, path, body, script = SAVE_TOKENS) => ({
  name,
  request: {
    method: 'POST',
    auth: { type: 'noauth' },
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: { raw: `{{baseUrl}}${path}`, host: ['{{baseUrl}}'], path: path.split('/').filter(Boolean) },
    body: { mode: 'raw', raw: JSON.stringify(body, null, 2) },
  },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: script } }],
});

async function main() {
  const res = await fetch(OPENAPI_URL);
  if (!res.ok) throw new Error(`GET ${OPENAPI_URL} → ${res.status} (is the API running, NODE_ENV≠production?)`);
  const spec = await res.json();

  const result = await promisify(converter.convert)(
    { type: 'json', data: spec },
    { folderStrategy: 'Tags', requestParametersResolution: 'Example', includeAuthInfoInExample: false },
  );
  if (!result.result) throw new Error(result.reason);
  const collection = result.output[0].data;

  collection.info.name = 'AI HR System API';
  collection.info.description =
    'Generated from the OpenAPI spec by `npm run postman`. Run a request in "0 · Sign in" first: the token is stored and used by every other request.';
  collection.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] };
  collection.variable = [
    { key: 'baseUrl', value: BASE_URL },
    { key: 'accessToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'mfaToken', value: '' },
  ];
  // Requests inherit the collection's Bearer auth instead of per-request copies.
  const inherit = (items) => {
    for (const it of items) {
      if (it.item) inherit(it.item);
      if (it.request) delete it.request.auth;
    }
  };
  inherit(collection.item);

  collection.item.unshift({
    name: '0 · Sign in',
    item: [
      ...ROLES.map(([role, email, password]) =>
        post(`Login as ${role}`, '/api/v1/auth/login', { email, password }),
      ),
      post('Verify MFA code', '/api/v1/auth/mfa/verify', { mfaToken: '{{mfaToken}}', code: '123456' }),
      post('Refresh tokens', '/api/v1/auth/refresh', { refreshToken: '{{refreshToken}}' }),
    ],
  });

  const environment = {
    name: 'AI HR System — local demo',
    values: [
      { key: 'baseUrl', value: BASE_URL, enabled: true },
      { key: 'adminEmail', value: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com', enabled: true },
      { key: 'adminPassword', value: '', type: 'secret', enabled: true },
      { key: 'demoPassword', value: process.env.DEMO_PASSWORD ?? 'DemoPassw0rd!', type: 'secret', enabled: true },
    ],
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/hr-system.postman_collection.json`, JSON.stringify(collection, null, 2) + '\n');
  await writeFile(`${OUT}/local-demo.postman_environment.json`, JSON.stringify(environment, null, 2) + '\n');

  const count = (items) => items.reduce((n, it) => n + (it.item ? count(it.item) : 1), 0);
  console.log(`Wrote ${OUT}/ — ${count(collection.item)} requests in ${collection.item.length} folders.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
