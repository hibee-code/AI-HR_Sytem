import type { DataSource } from 'typeorm';
import { Permission } from '../../modules/rbac/entities/permission.entity';
import { Role } from '../../modules/rbac/entities/role.entity';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  SystemRole,
} from '../../modules/rbac/permissions.catalogue';
import type { Seeder } from './seeder.interface';

/**
 * Upserts the permission catalogue and system roles. Safe to re-run after
 * adding permissions to the catalogue: new ones are inserted and system
 * roles' permission sets are re-synced to their definitions.
 * Also safe for production — it only touches catalogue data.
 */
export class RolesPermissionsSeeder implements Seeder {
  readonly name = 'roles & permissions';

  async run(ds: DataSource): Promise<void> {
    await ds.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .insert()
        .into(Permission)
        .values(ALL_PERMISSIONS.map((name) => ({ name, description: null })))
        .orIgnore()
        .execute();

      const permissions = await em.find(Permission);
      const byName = new Map(permissions.map((p) => [p.name, p]));

      for (const [name, def] of Object.entries(SYSTEM_ROLE_DEFINITIONS) as [
        SystemRole,
        (typeof SYSTEM_ROLE_DEFINITIONS)[SystemRole],
      ][]) {
        let role = await em.findOne(Role, {
          where: { name },
          relations: { permissions: true },
        });
        if (!role) {
          role = em.create(Role, {
            name,
            description: def.description,
            isSystem: true,
          });
        }
        role.isSystem = true;
        role.permissions = def.permissions.map((p) => byName.get(p)!);
        await em.save(role);
      }
    });
  }
}
