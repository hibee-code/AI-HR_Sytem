import type { ValueTransformer } from 'typeorm';
import { SecretBox } from './secret-box';

/**
 * Column-level encryption for personal and pay data (AES-256-GCM via
 * SecretBox). Keys: FIELD_ENCRYPTION_KEY (current) and, while rotating,
 * FIELD_ENCRYPTION_KEY_PREVIOUS. Read from the process env lazily so the same
 * transformers work in the API, migrations and CLIs. Encrypted columns can't be
 * searched or sorted in SQL — only encrypt what isn't queried.
 */
let box: SecretBox | null = null;

export function fieldCipher(): SecretBox {
  if (!box) {
    const key = process.env.FIELD_ENCRYPTION_KEY;
    if (!key) throw new Error('FIELD_ENCRYPTION_KEY is not set');
    box = new SecretBox(key, [process.env.FIELD_ENCRYPTION_KEY_PREVIOUS]);
  }
  return box;
}

/** Tests / key rotation tools only. */
export function resetFieldCipher(): void {
  box = null;
}

function sealed<T>(
  toText: (v: T) => string,
  fromText: (s: string) => T,
): ValueTransformer {
  return {
    to: (v: T | null | undefined) =>
      v === null || v === undefined ? v : fieldCipher().encrypt(toText(v)),
    from: (s: string | null) =>
      s === null
        ? null
        : fromText(SecretBox.isSealed(s) ? fieldCipher().decrypt(s) : s),
  };
}

export const encrypted = {
  string: sealed<string>(
    (v) => v,
    (s) => s,
  ),
  number: sealed<number>(String, Number),
  json: sealed<unknown>(JSON.stringify, (s) => JSON.parse(s) as unknown),
};

type Kind = 'string' | 'number' | 'json';

/**
 * Every encrypted column, by table — the one list the entities' transformers,
 * the migration, the data export and `secrets:reencrypt` agree on.
 */
export const ENCRYPTED_COLUMNS: Record<string, Record<string, Kind>> = {
  employees: {
    personal_email: 'string',
    phone: 'string',
    date_of_birth: 'string',
    address: 'json',
    emergency_contact: 'json',
  },
  salary_structures: {
    base_amount: 'number',
    lines: 'json',
    annual_rent: 'number',
  },
};

/** Raw SQL row → plaintext values for the table's encrypted columns. */
export function decryptRow<T extends Record<string, unknown>>(
  table: string,
  row: T,
): T {
  const cols = ENCRYPTED_COLUMNS[table] ?? {};
  const out: Record<string, unknown> = { ...row };
  for (const [col, kind] of Object.entries(cols)) {
    const v = row[col];
    if (typeof v === 'string') out[col] = encrypted[kind].from(v);
  }
  return out as T;
}
