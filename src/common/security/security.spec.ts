import { SecretBox } from './secret-box';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC 6238 vector at T=%i', (t, expected) => {
    expect(totpCode(RFC_SECRET, Math.floor(t / 30), 8)).toBe(expected);
  });

  it('base32 round-trips and matches the known encoding', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
  });

  it('accepts the current and adjacent steps only, returning the step', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 2), now)).toBeNull();
    expect(verifyTotp(secret, 'abc123', now)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    expect(otpauthUrl('ABC', 'jane@x.io', 'HR System')).toBe(
      'otpauth://totp/HR%20System%3Ajane%40x.io?secret=ABC&issuer=HR+System&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('SecretBox', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const box = new SecretBox('k'.repeat(32));
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(box.encrypt('JBSWY3DPEHPK3PXP'));
    expect(box.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampering and the wrong key', () => {
    const sealed = new SecretBox('k'.repeat(32)).encrypt('secret');
    expect(() => new SecretBox('x'.repeat(32)).decrypt(sealed)).toThrow();
    const [v, iv, tag, data] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag}.${data.slice(0, -2)}AA`;
    expect(() => new SecretBox('k'.repeat(32)).decrypt(flipped)).toThrow();
  });
});
