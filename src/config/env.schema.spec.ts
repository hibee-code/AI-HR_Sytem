import { validateEnv } from './env.schema';

const valid = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'hr',
  DB_PASSWORD: 'hr',
  DB_NAME: 'hr_system',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MFA_ENCRYPTION_KEY: 'c'.repeat(32),
  STORAGE_DRIVER: 'memory',
};

/** Passes every production-only rule, so each test isolates one. */
const prodValid = {
  ...valid,
  NODE_ENV: 'production',
  STORAGE_DRIVER: 'cloudinary',
  CLOUDINARY_CLOUD_NAME: 'c',
  CLOUDINARY_API_KEY: 'k',
  CLOUDINARY_API_SECRET: 's',
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
    expect(() => validateEnv({ ...prodValid, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('parses MFA_REQUIRED_ROLES; empty means nobody', () => {
    expect(validateEnv(valid).MFA_REQUIRED_ROLES).toEqual([
      'ADMIN',
      'HR_MANAGER',
    ]);
    expect(
      validateEnv({ ...valid, MFA_REQUIRED_ROLES: ' admin , ' })
        .MFA_REQUIRED_ROLES,
    ).toEqual(['ADMIN']);
    expect(
      validateEnv({ ...valid, MFA_REQUIRED_ROLES: '' }).MFA_REQUIRED_ROLES,
    ).toEqual([]);
  });

  it('accepts a complete production config', () => {
    expect(validateEnv(prodValid).NODE_ENV).toBe('production');
  });

  it('forbids dev-only drivers in production', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'memory',
      AI_DRIVER: 'fake',
    };
    expect(() => validateEnv(prod)).toThrow(/STORAGE_DRIVER[\s\S]*AI_DRIVER/);
  });

  it('forbids disabling rate limiting in production', () => {
    expect(() =>
      validateEnv({ ...prodValid, THROTTLE_ENABLED: 'false' }),
    ).toThrow(/THROTTLE_ENABLED/);
    expect(validateEnv({ ...valid, THROTTLE_ENABLED: 'false' })).toMatchObject({
      THROTTLE_ENABLED: false,
    });
  });

  it('requires Cloudinary credentials when the cloudinary driver is selected', () => {
    expect(() =>
      validateEnv({ ...valid, STORAGE_DRIVER: 'cloudinary' }),
    ).toThrow(/CLOUDINARY_\*/);
    expect(() =>
      validateEnv({
        ...valid,
        STORAGE_DRIVER: 'cloudinary',
        CLOUDINARY_CLOUD_NAME: 'c',
        CLOUDINARY_API_KEY: 'k',
        CLOUDINARY_API_SECRET: 's',
      }),
    ).not.toThrow();
  });
});
