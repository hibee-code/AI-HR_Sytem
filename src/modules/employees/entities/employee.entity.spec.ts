import { instanceToPlain } from 'class-transformer';
import {
  Employee,
  EmployeeStatus,
  EmploymentType,
  SERIALIZE_FULL,
} from './employee.entity';

function sample(): Employee {
  return Object.assign(new Employee(), {
    id: 'e1',
    userId: 'u1',
    employeeNumber: 'EMP-0001',
    firstName: 'Jane',
    lastName: 'Doe',
    workEmail: 'jane@company.com',
    personalEmail: 'jane@gmail.com',
    phone: '+2348000000',
    dateOfBirth: '1990-05-14',
    address: { line1: '1 Road', city: 'Lagos', country: 'NG' },
    emergencyContact: { name: 'John', relationship: 'spouse', phone: '+234' },
    photoUrl: null,
    hireDate: '2026-10-01',
    terminationDate: null,
    status: EmployeeStatus.ACTIVE,
    employmentType: EmploymentType.FULL_TIME,
    departmentId: 'd1',
    positionId: null,
    managerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
}

const PERSONAL = [
  'userId',
  'personalEmail',
  'phone',
  'dateOfBirth',
  'address',
  'emergencyContact',
  'terminationDate',
];
const PUBLIC = [
  'id',
  'employeeNumber',
  'firstName',
  'lastName',
  'fullName',
  'workEmail',
  'hireDate',
  'status',
  'departmentId',
];

describe('Employee serialisation groups', () => {
  it('directory view (no groups) omits every personal field', () => {
    const plain = instanceToPlain(sample());
    for (const key of PERSONAL) expect(plain).not.toHaveProperty(key);
    for (const key of PUBLIC) expect(plain).toHaveProperty(key);
    expect(plain.fullName).toBe('Jane Doe');
  });

  it('full view includes personal fields', () => {
    const plain = instanceToPlain(sample(), { groups: [SERIALIZE_FULL] });
    for (const key of [...PERSONAL, ...PUBLIC])
      expect(plain).toHaveProperty(key);
  });

  it('nested manager is scoped the same way as the root', () => {
    const emp = sample();
    emp.manager = Object.assign(sample(), {
      id: 'm1',
      personalEmail: 'boss@gmail.com',
    });
    const directory = instanceToPlain(emp) as {
      manager: Record<string, unknown>;
    };
    expect(directory.manager).not.toHaveProperty('personalEmail');
    expect(directory.manager).toHaveProperty('workEmail');
  });
});
