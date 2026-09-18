import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 * Validated once at boot; the app refuses to start on any violation.
 * Keep .env.example in sync with this file.
 */

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const port = z.coerce.number().int().min(1).max(65535);

/** "15m", "7d", "3600s" — parsed downstream by the JWT library. */
const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/, 'expected e.g. 15m, 7d');

export const envSchema = z.object({
  // ── App ───────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: port.default(3000),
  API_PREFIX: z.string().default('api'),
  APP_URL: z.url().default('http://localhost:3000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // ── Database ──────────────────────────────────────────────────────────
  DB_HOST: z.string().min(1),
  DB_PORT: port.default(5432),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_SSL: bool,
  DB_LOGGING: bool,

  // ── Redis ─────────────────────────────────────────────────────────────
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: port.default(6379),
  REDIS_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  REDIS_DB: z.coerce.number().int().min(0).default(0),

  // ── Rate limiting ─────────────────────────────────────────────────────
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  // ── Auth ──────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_TTL: duration.default('7d'),

  // ── Seeding (dev only) ────────────────────────────────────────────────
  SEED_ADMIN_EMAIL: z.email().default('admin@example.com'),
  SEED_ADMIN_PASSWORD: z.string().min(10).default('ChangeMe123!'),

  // ── Cloudinary (optional until the documents module is enabled) ───────
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // ── Email ─────────────────────────────────────────────────────────────
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: port.default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('HR System <no-reply@example.com>'),

  // ── Slack ─────────────────────────────────────────────────────────────
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DEFAULT_CHANNEL: z.string().default('#hr-notifications'),

  // ── AI ────────────────────────────────────────────────────────────────
  HF_API_TOKEN: z.string().optional(),
  HF_EMBEDDING_MODEL: z
    .string()
    .default('sentence-transformers/all-MiniLM-L6-v2'),
  HF_CHAT_MODEL: z.string().default('mistralai/Mistral-7B-Instruct-v0.3'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Used by ConfigModule.forRoot({ validate }). Throws a readable, multi-line
 * error listing every offending variable rather than only the first.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.CORS_ORIGINS.includes('*')
  ) {
    throw new Error(
      'Invalid environment configuration:\n  - CORS_ORIGINS: "*" is not allowed in production',
    );
  }
  return result.data;
}
