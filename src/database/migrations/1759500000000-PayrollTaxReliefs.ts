import { MigrationInterface, QueryRunner } from 'typeorm';

/** Declared rent for PAYE rent relief; taxable pay per payslip for cumulative PAYE. */
export class PayrollTaxReliefs1759500000000 implements MigrationInterface {
  name = 'PayrollTaxReliefs1759500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "salary_structures" ADD "annual_rent" numeric(14,2)`,
    );
    await q.query(`ALTER TABLE "payslips" ADD "taxable_amount" numeric(14,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payslips" DROP COLUMN "taxable_amount"`);
    await q.query(`ALTER TABLE "salary_structures" DROP COLUMN "annual_rent"`);
  }
}
