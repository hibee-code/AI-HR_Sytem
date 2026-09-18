import type { DataSource } from 'typeorm';
import { ChecklistTemplateItem } from '../../modules/onboarding/entities/checklist-template-item.entity';
import {
  AssigneeRule,
  ChecklistTemplate,
  ChecklistType,
} from '../../modules/onboarding/entities/checklist-template.entity';
import type { Seeder } from './seeder.interface';

type Item = Pick<
  ChecklistTemplateItem,
  'title' | 'assigneeRule' | 'dueOffsetDays'
> &
  Partial<
    Pick<
      ChecklistTemplateItem,
      'description' | 'assigneeRoleName' | 'isRequired'
    >
  >;

const ONBOARDING: Item[] = [
  {
    title: 'Sign employment contract',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: -3,
  },
  {
    title: 'Submit ID and bank details',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: -1,
  },
  {
    title: 'Provision laptop and accounts',
    assigneeRule: AssigneeRule.HR,
    dueOffsetDays: -1,
  },
  {
    title: 'Prepare 30-day plan',
    assigneeRule: AssigneeRule.MANAGER,
    dueOffsetDays: 0,
  },
  {
    title: 'Day-one welcome & team intro',
    assigneeRule: AssigneeRule.MANAGER,
    dueOffsetDays: 0,
  },
  {
    title: 'Complete policy acknowledgement',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: 5,
  },
  {
    title: 'Security & compliance training',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: 10,
  },
  {
    title: '30-day check-in',
    assigneeRule: AssigneeRule.MANAGER,
    dueOffsetDays: 30,
    isRequired: false,
  },
];

const OFFBOARDING: Item[] = [
  {
    title: 'Handover document',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: -5,
  },
  { title: 'Exit interview', assigneeRule: AssigneeRule.HR, dueOffsetDays: -2 },
  {
    title: 'Return laptop and badge',
    assigneeRule: AssigneeRule.EMPLOYEE,
    dueOffsetDays: 0,
  },
  {
    title: 'Revoke system access',
    assigneeRule: AssigneeRule.HR,
    dueOffsetDays: 0,
  },
  {
    title: 'Final payroll & benefits',
    assigneeRule: AssigneeRule.HR,
    dueOffsetDays: 3,
  },
  {
    title: 'Reassign open work',
    assigneeRule: AssigneeRule.MANAGER,
    dueOffsetDays: -1,
  },
];

/** Company-wide default templates. Idempotent by (name, type). */
export class ChecklistTemplatesSeeder implements Seeder {
  readonly name = 'checklist templates';

  async run(ds: DataSource): Promise<void> {
    const repo = ds.getRepository(ChecklistTemplate);
    const items = ds.getRepository(ChecklistTemplateItem);

    for (const [name, type, list] of [
      ['Default onboarding', ChecklistType.ONBOARDING, ONBOARDING],
      ['Default offboarding', ChecklistType.OFFBOARDING, OFFBOARDING],
    ] as const) {
      if (await repo.exists({ where: { name, type } })) continue;
      await repo.save(
        repo.create({
          name,
          type,
          description: 'Seeded default; edit under /checklist-templates',
          departmentId: null,
          isActive: true,
          items: list.map((i, idx) =>
            items.create({
              title: i.title,
              description: i.description ?? null,
              assigneeRule: i.assigneeRule,
              assigneeRoleName:
                i.assigneeRule === AssigneeRule.HR
                  ? 'HR_MANAGER'
                  : (i.assigneeRoleName ?? null),
              dueOffsetDays: i.dueOffsetDays,
              sortOrder: idx,
              isRequired: i.isRequired ?? true,
            }),
          ),
        }),
      );
    }
  }
}
