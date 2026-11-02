import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ENCRYPTED_COLUMNS,
  fieldCipher,
} from '../../common/security/field-encryption';

/** Original column types, for the way back down. */
const ORIGINAL: Record<string, Record<string, string>> = {
  employees: {
    personal_email: 'citext',
    phone: 'varchar(30)',
    date_of_birth: 'date',
    address: 'jsonb',
    emergency_contact: 'jsonb',
  },
  salary_structures: {
    base_amount: 'numeric(14,2)',
    lines: 'jsonb',
    annual_rent: 'numeric(14,2)',
  },
};

/**
 * Personal and pay fields become AES-256-GCM ciphertext (FIELD_ENCRYPTION_KEY
 * must be set when this runs). Existing rows are encrypted in place.
 */
export class EncryptPersonalFields1759800000000 implements MigrationInterface {
  name = 'EncryptPersonalFields1759800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "salary_structures" ALTER COLUMN "lines" DROP DEFAULT`,
    );
    for (const [table, cols] of Object.entries(ENCRYPTED_COLUMNS)) {
      for (const col of Object.keys(cols)) {
        await q.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE text USING "${col}"::text`,
        );
      }
      await rewrite(q, table, Object.keys(cols), (v) =>
        fieldCipher().encrypt(v),
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [table, cols] of Object.entries(ENCRYPTED_COLUMNS)) {
      await rewrite(q, table, Object.keys(cols), (v) =>
        fieldCipher().decrypt(v),
      );
      for (const col of Object.keys(cols)) {
        const type = ORIGINAL[table][col];
        await q.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE ${type} USING "${col}"::${type}`,
        );
      }
    }
    await q.query(
      `ALTER TABLE "salary_structures" ALTER COLUMN "lines" SET DEFAULT '[]'`,
    );
  }
}

/** Applies `fn` to every non-null value of the columns, row by row. */
async function rewrite(
  q: QueryRunner,
  table: string,
  cols: string[],
  fn: (value: string) => string,
): Promise<void> {
  const rows: Record<string, string | null>[] = await q.query(
    `SELECT id, ${cols.map((c) => `"${c}"`).join(', ')} FROM "${table}"`,
  );
  for (const row of rows) {
    const sets = cols.filter((c) => row[c] !== null);
    if (sets.length === 0) continue;
    await q.query(
      `UPDATE "${table}" SET ${sets.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
      [row.id, ...sets.map((c) => fn(row[c]!))],
    );
  }
}
