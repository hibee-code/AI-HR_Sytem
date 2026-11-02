/**
 * Finishes a key rotation: rewrites every encrypted value under the CURRENT
 * keys. Procedure (docs/operations/secrets.md):
 *   1. set FIELD_ENCRYPTION_KEY_PREVIOUS / MFA_ENCRYPTION_KEY_PREVIOUS to the
 *      old keys and the main variables to new ones; restart (both readable)
 *   2. node dist/cli/reencrypt-secrets.js
 *   3. remove the *_PREVIOUS variables; restart
 */
import dataSource from '../database/data-source';
import {
  ENCRYPTED_COLUMNS,
  fieldCipher,
} from '../common/security/field-encryption';
import { SecretBox } from '../common/security/secret-box';

async function main(): Promise<void> {
  const mfaKey = process.env.MFA_ENCRYPTION_KEY;
  if (!mfaKey) throw new Error('MFA_ENCRYPTION_KEY is not set');
  const mfa = new SecretBox(mfaKey, [process.env.MFA_ENCRYPTION_KEY_PREVIOUS]);
  const field = fieldCipher();

  await dataSource.initialize();
  try {
    const counts: Record<string, number> = {};
    await dataSource.transaction(async (em) => {
      const targets: [string, string[], SecretBox][] = [
        ...Object.entries(ENCRYPTED_COLUMNS).map(
          ([t, cols]) =>
            [t, Object.keys(cols), field] as [string, string[], SecretBox],
        ),
        ['users', ['mfa_secret'], mfa],
      ];
      for (const [table, cols, box] of targets) {
        const rows: Record<string, string | null>[] = await em.query(
          `SELECT id, ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`,
        );
        let n = 0;
        for (const row of rows) {
          const sets = cols.filter(
            (c) => row[c] && SecretBox.isSealed(row[c]!),
          );
          if (!sets.length) continue;
          await em.query(
            `UPDATE "${table}" SET ${sets.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
            [row.id, ...sets.map((c) => box.encrypt(box.decrypt(row[c]!)))],
          );
          n++;
        }
        counts[table] = n;
      }
    });
    console.log('re-encrypted rows:', counts);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
