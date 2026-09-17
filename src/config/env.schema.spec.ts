import { validateEnv } from './env.schema';

const valid = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'hr',
  DB_PASSWORD: 'hr',
  DB_NAME: 'hr_system',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(5432);
    expect(env.DB_SSL).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('parses CORS_ORIGINS into a trimmed list', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGINS: ' http://a.com, http://b.com ,',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('lists every missing variable in one error', () => {
    expect(() => validateEnv({})).toThrow(/DB_HOST[\s\S]*JWT_ACCESS_SECRET/);
  });

  it('rejects short JWT secrets', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects malformed durations', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_TTL: '15 minutes' }),
    ).toThrow(/JWT_ACCESS_TTL/);
  });

  it('forbids wildcard CORS in production', () => {
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);
  });
});
