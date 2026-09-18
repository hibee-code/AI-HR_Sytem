import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import { Role } from '../../modules/rbac/entities/role.entity';
import { SYSTEM_ROLES } from '../../modules/rbac/permissions.catalogue';
import { User, UserStatus } from '../../modules/users/entities/user.entity';
import type { Seeder } from './seeder.interface';

/**
 * Creates the bootstrap ADMIN account from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Skips if that email already exists (never resets a password).
 */
export class AdminUserSeeder implements Seeder {
  readonly name = 'admin user';

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}

  async run(ds: DataSource): Promise<void> {
    const users = ds.getRepository(User);
    if (
      await users.findOne({ where: { email: this.email }, withDeleted: true })
    ) {
      process.stdout.write('(exists, skipped) ');
      return;
    }
    const admin = await ds
      .getRepository(Role)
      .findOneByOrFail({ name: SYSTEM_ROLES.ADMIN });
    await users.save(
      users.create({
        email: this.email,
        firstName: 'System',
        lastName: 'Admin',
        status: UserStatus.ACTIVE,
        passwordHash: await argon2.hash(this.password, {
          type: argon2.argon2id,
        }),
        passwordChangedAt: new Date(),
        roles: [admin],
      }),
    );
  }
}
