import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits) — the variant every
 * authenticator app (Google Authenticator, Microsoft Authenticator, 1Password,
 * Authy) supports. Kept dependency-free; verified against the RFC vectors.
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, as RFC 4226 recommends
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(
  secret: string,
  step: number,
  digits = DIGITS,
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Returns the time step the code matches (current ±`window` steps, to absorb
 * clock drift), or null. Callers reject steps ≤ the last one used (replay).
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  for (let step = now - window; step <= now + window; step++) {
    if (safeEqual(totpCode(secret, step), code)) return step;
  }
  return null;
}

/** otpauth:// URI for QR codes (Key URI Format). */
export function otpauthUrl(
  secret: string,
  account: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function safeEqual(a: string, b: string): boolean {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
