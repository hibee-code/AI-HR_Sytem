import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * AES-256-GCM for small secrets at rest (TOTP seeds, personal fields). Keys
 * are derived from configured passphrases; output is `v1.<iv>.<tag>.<data>`
 * (base64url). Encrypts with the current key; decrypts with the current or
 * any previous one, so keys can be rotated without downtime.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly previous: Buffer[];

  constructor(passphrase: string, previous: (string | undefined)[] = []) {
    this.key = derive(passphrase);
    this.previous = previous.filter((p): p is string => !!p).map(derive);
  }

  static isSealed(value: string): boolean {
    return value.startsWith('v1.');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data)
      throw new Error('Unsupported secret format');
    for (const key of [this.key, ...this.previous]) {
      try {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([
          decipher.update(Buffer.from(data, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // wrong key (or tampered): try the next one
      }
    }
    throw new Error('Unable to decrypt: unknown key or tampered data');
  }
}

function derive(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase).digest();
}
