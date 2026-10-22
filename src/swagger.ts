import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from './config/env.schema';

const DESCRIPTION = `
HR management API with AI-assisted features. Every route is versioned under \`/api/v1\`.

### Testing in the browser
1. Open **auth → POST /auth/login**, *Try it out*, send your email + password.
   The access token is applied to every other request automatically (no copy-paste).
2. If the response says \`mfaRequired: true\`, send the \`mfaToken\` with a 6-digit code to
   **POST /auth/mfa/verify** — the token is applied the same way.
3. Admin / HR accounts must enrol in MFA first: **POST /auth/mfa/setup** (scan \`otpauthUrl\`
   with an authenticator app) → **POST /auth/mfa/enable**. Until then other routes answer
   \`403 MFA_SETUP_REQUIRED\`.
4. Access tokens last 15 minutes: run **POST /auth/refresh** with the refresh token (also
   auto-applied), or log in again. **Authorize** (top right) sets a token by hand.

Demo company (\`npm run seed:demo\`): \`hr@demo.local\`, \`eng@demo.local\`, \`dev1@demo.local\`,
\`rec@demo.local\`, … with \`DEMO_PASSWORD\`.

### Conventions
- Errors always share one shape: \`{ statusCode, error, message, path, timestamp, correlationId }\`.
  \`error\` carries machine codes such as \`MFA_SETUP_REQUIRED\`, \`ACCOUNT_LOCKED\`, \`AI_DAILY_LIMIT\`.
- Lists are paginated with \`?page=&limit=\` and return \`{ data, meta }\`.
- Unknown body properties are rejected (400).
`;

/** Tag order (and blurbs) in the UI; tags not listed follow alphabetically. */
const TAGS: [name: string, description: string][] = [
  ['auth', 'Login, MFA, tokens, invites, passwords'],
  ['users', 'Accounts, roles, suspension, lockout and MFA recovery'],
  ['rbac', 'Roles and the permission catalogue'],
  ['employees', 'HR records, transfers, status, termination'],
  ['organisation', 'Departments, positions, org chart'],
  ['onboarding', 'On/offboarding checklists and templates'],
  ['leave', 'Leave types, balances, requests, holidays'],
  ['attendance', 'Clock in/out and attendance reports'],
  ['documents', 'Uploads, versions, signed downloads'],
  ['performance', 'Review cycles, goals, reviews, feedback'],
  [
    'payroll',
    'Salary structures, runs, payslips (Nigerian PAYE / pension / NHF)',
  ],
  ['ai', 'Policy assistant (JSON + streaming), knowledge base, usage'],
  ['recruiting', 'Openings, applications, AI résumé screening'],
  ['notifications', 'Preferences, delivery log, test sends'],
  ['audit', 'Who did what (ADMIN)'],
  ['privacy', 'Data-subject exports, applicant erasure, retention (NDPA)'],
  ['health', 'Liveness / readiness probes'],
];

/**
 * Swagger UI at /<prefix>/docs (JSON at /<prefix>/docs-json). On by default
 * outside production; in production only with SWAGGER_ENABLED=true, behind
 * basic auth (SWAGGER_USER / SWAGGER_PASSWORD, enforced by the env schema).
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  if (!config.get('SWAGGER_ENABLED', { infer: true })) return;
  const path = `${config.get('API_PREFIX', { infer: true })}/docs`;

  const user = config.get('SWAGGER_USER', { infer: true });
  const password = config.get('SWAGGER_PASSWORD', { infer: true });
  if (user && password)
    app.use(
      [`/${path}`, `/${path}-json`, `/${path}-yaml`],
      basicAuth(user, password),
    );

  const builder = new DocumentBuilder()
    .setTitle(`${config.get('APP_NAME', { infer: true })} API`)
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    // Every route needs a token unless it says otherwise (@Public → security: [{}]).
    .addSecurityRequirements('access-token');
  for (const [name, description] of TAGS) builder.addTag(name, description);

  const document = SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });
  polish(document);

  SwaggerModule.setup(path, app, document, {
    customSiteTitle: 'HR System API',
    swaggerOptions: {
      persistAuthorization: true, // survive page reloads
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      // Runs in the browser (serialised by Nest): adopt tokens from auth responses.
      responseInterceptor: (res: {
        url: string;
        status: number;
        body?: { accessToken?: string };
      }) => {
        if (
          res.status === 200 &&
          /\/auth\/(login|mfa\/verify|refresh|accept-invite)$/.test(res.url) &&
          res.body?.accessToken
        ) {
          (
            globalThis as unknown as {
              ui: { preauthorizeApiKey(n: string, v: string): void };
            }
          ).ui.preauthorizeApiKey('access-token', res.body.accessToken);
        }
        return res;
      },
    },
  });
}

/**
 * One shared error schema as every operation's `default` response, and a
 * readable summary ("List conversations") for routes that don't set one.
 */
function polish(doc: OpenAPIObject): void {
  doc.components ??= {};
  doc.components.schemas ??= {};
  doc.components.schemas.ErrorResponse = {
    type: 'object',
    required: ['statusCode', 'error', 'message', 'path', 'timestamp'],
    properties: {
      statusCode: { type: 'integer', example: 403 },
      error: { type: 'string', example: 'MFA_SETUP_REQUIRED' },
      message: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        example: 'Your role requires two-factor authentication.',
      },
      path: { type: 'string', example: '/api/v1/employees' },
      timestamp: { type: 'string', format: 'date-time' },
      correlationId: { type: 'string' },
    },
  };
  const order = new Map(TAGS.map(([name], i) => [name, i]));
  doc.tags = [...(doc.tags ?? [])].sort(
    (a, b) =>
      (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99) ||
      a.name.localeCompare(b.name),
  );

  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      if (!op || typeof op !== 'object' || !('responses' in op)) continue;
      op.summary ??= humanise(String(op.operationId ?? ''));
      op.responses.default ??= {
        description: 'Error (see ErrorResponse; `error` holds the code)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      };
    }
  }
}

/** "Org_deleteDepartment" → "Delete department". */
function humanise(operationId: string): string {
  const method = operationId.split('_')[1] ?? operationId;
  const words = method.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function basicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);
  return (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const given = Buffer.from(
      scheme === 'Basic' && encoded
        ? Buffer.from(encoded, 'base64').toString()
        : '',
    );
    if (given.length === expected.length && timingSafeEqual(given, expected))
      return next();
    res.set('WWW-Authenticate', 'Basic realm="API docs"').status(401).end();
  };
}
