import { decryptRow, encrypted, resetFieldCipher } from './field-encryption';
import { SecretBox } from './secret-box';

describe('field encryption', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, FIELD_ENCRYPTION_KEY: 'k'.repeat(32) };
    resetFieldCipher();
  });
  afterAll(() => {
    process.env = env;
    resetFieldCipher();
  });

  it('round-trips strings, numbers and JSON; nulls stay null', () => {
    const s = encrypted.string.to('1990-05-14') as string;
    expect(SecretBox.isSealed(s)).toBe(true);
    expect(s).not.toContain('1990');
    expect(encrypted.string.from(s)).toBe('1990-05-14');
    expect(encrypted.number.from(encrypted.number.to(850000.5))).toBe(850000.5);
    const addr = { line1: '1 Marina', city: 'Lagos', country: 'NG' };
    expect(encrypted.json.from(encrypted.json.to(addr))).toEqual(addr);
    expect(encrypted.json.to(null)).toBeNull();
    expect(encrypted.json.from(null)).toBeNull();
  });

  it('decrypts raw SQL rows for export', () => {
    const row = {
      id: 'e1',
      phone: encrypted.string.to('+234 803'),
      first_name: 'Ada',
    };
    expect(decryptRow('employees', row)).toEqual({
      id: 'e1',
      phone: '+234 803',
      first_name: 'Ada',
    });
  });

  it('rotation: values sealed with the previous key still open', () => {
    const old = encrypted.string.to('secret') as string;
    process.env.FIELD_ENCRYPTION_KEY = 'n'.repeat(32);
    resetFieldCipher();
    expect(() => encrypted.string.from(old)).toThrow(/Unable to decrypt/);
    process.env.FIELD_ENCRYPTION_KEY_PREVIOUS = 'k'.repeat(32);
    resetFieldCipher();
    expect(encrypted.string.from(old)).toBe('secret');
  });
});
