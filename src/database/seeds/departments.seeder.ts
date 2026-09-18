import type { DataSource } from 'typeorm';
import { Department } from '../../modules/employees/entities/department.entity';
import { Position } from '../../modules/employees/entities/position.entity';
import type { Seeder } from './seeder.interface';

const DEPARTMENTS: { code: string; name: string; parent?: string }[] = [
  { code: 'EXEC', name: 'Executive' },
  { code: 'ENG', name: 'Engineering', parent: 'EXEC' },
  { code: 'ENG_PLAT', name: 'Platform', parent: 'ENG' },
  { code: 'ENG_PROD', name: 'Product Engineering', parent: 'ENG' },
  { code: 'PEOPLE', name: 'People & Culture', parent: 'EXEC' },
  { code: 'FIN', name: 'Finance', parent: 'EXEC' },
  { code: 'SALES', name: 'Sales', parent: 'EXEC' },
];

const POSITIONS: { title: string; level?: string; dept?: string }[] = [
  { title: 'Chief Executive Officer', level: 'C', dept: 'EXEC' },
  { title: 'VP Engineering', level: 'VP', dept: 'ENG' },
  { title: 'Engineering Manager', level: 'M1', dept: 'ENG' },
  { title: 'Staff Engineer', level: 'L6', dept: 'ENG' },
  { title: 'Senior Engineer', level: 'L5', dept: 'ENG' },
  { title: 'Software Engineer', level: 'L4', dept: 'ENG' },
  { title: 'Head of People', level: 'D', dept: 'PEOPLE' },
  { title: 'HR Business Partner', level: 'L5', dept: 'PEOPLE' },
  { title: 'Recruiter', level: 'L4', dept: 'PEOPLE' },
  { title: 'Finance Manager', level: 'M1', dept: 'FIN' },
  { title: 'Accountant', level: 'L4', dept: 'FIN' },
  { title: 'Account Executive', level: 'L4', dept: 'SALES' },
  { title: 'Intern' }, // company-wide
];

/** Sample org structure for local development. Idempotent on department code / position title. */
export class DepartmentsSeeder implements Seeder {
  readonly name = 'departments & positions';

  async run(ds: DataSource): Promise<void> {
    const depts = ds.getRepository(Department);
    const positions = ds.getRepository(Position);

    const byCode = new Map<string, Department>();
    for (const d of DEPARTMENTS) {
      let dept = await depts.findOne({ where: { code: d.code } });
      if (!dept) {
        dept = await depts.save(
          depts.create({
            code: d.code,
            name: d.name,
            description: null,
            parentId: d.parent ? byCode.get(d.parent)!.id : null,
            headEmployeeId: null,
          }),
        );
      }
      byCode.set(d.code, dept);
    }

    for (const p of POSITIONS) {
      const departmentId = p.dept ? byCode.get(p.dept)!.id : null;
      const exists = await positions.findOne({
        where: { title: p.title, ...(departmentId ? { departmentId } : {}) },
      });
      if (!exists) {
        await positions.save(
          positions.create({
            title: p.title,
            level: p.level ?? null,
            departmentId,
            isActive: true,
          }),
        );
      }
    }
  }
}
