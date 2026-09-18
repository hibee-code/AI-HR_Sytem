import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { User } from '../users/entities/user.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import {
  ALL_PERMISSIONS,
  Permission as PermissionName,
} from './permissions.catalogue';

/** How long a user's resolved auth context lives in Redis. */
const AUTH_CONTEXT_TTL_SECONDS = 300;

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── Auth context (hot path: called by JwtAuthGuard on every request) ──────

  /**
   * Resolves status + roles + union of permissions for a user, cached in Redis.
   * Returns null if the user no longer exists (or is soft-deleted).
   */
  async getAuthUser(userId: string): Promise<AuthUser | null> {
    const key = this.cacheKey(userId);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as AuthUser;

    const user = await this.users.findOne({
      where: { id: userId },
      relations: { roles: { permissions: true } },
    });
    if (!user) return null;

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles.map((r) => r.name).sort(),
      permissions: [
        ...new Set(user.roles.flatMap((r) => r.permissions.map((p) => p.name))),
      ].sort() as PermissionName[],
      passwordChangedAt: user.passwordChangedAt
        ? Math.floor(user.passwordChangedAt.getTime() / 1000)
        : null,
    };

    await this.redis.set(
      key,
      JSON.stringify(authUser),
      'EX',
      AUTH_CONTEXT_TTL_SECONDS,
    );
    return authUser;
  }

  /** Call after anything that changes a user's status or roles. */
  async invalidateAuthUser(userId: string): Promise<void> {
    await this.redis.del(this.cacheKey(userId));
  }

  /** Call after a role's permission set changes: affects every holder. */
  async invalidateRoleHolders(roleId: string): Promise<void> {
    const holders = await this.users
      .createQueryBuilder('u')
      .innerJoin('u.roles', 'r', 'r.id = :roleId', { roleId })
      .select('u.id', 'id')
      .getRawMany<{ id: string }>();
    if (holders.length === 0) return;
    await this.redis.del(...holders.map((h) => this.cacheKey(h.id)));
  }

  private cacheKey(userId: string): string {
    return `auth:user:${userId}`;
  }

  // ── Role management ──────────────────────────────────────────────────────

  findAllRoles(): Promise<Role[]> {
    return this.roles.find({
      relations: { permissions: true },
      order: { name: 'ASC' },
    });
  }

  async findRoleById(id: string): Promise<Role> {
    const role = await this.roles.findOne({
      where: { id },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async findRolesByNames(names: string[]): Promise<Role[]> {
    if (names.length === 0) return [];
    const roles = await this.roles.find({ where: { name: In(names) } });
    const missing = names.filter((n) => !roles.some((r) => r.name === n));
    if (missing.length > 0) {
      throw new BadRequestException(`Unknown role(s): ${missing.join(', ')}`);
    }
    return roles;
  }

  async createRole(input: {
    name: string;
    description?: string;
    permissions: PermissionName[];
  }): Promise<Role> {
    const permissions = await this.resolvePermissions(input.permissions);
    const role = this.roles.create({
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
      permissions,
    });
    return this.roles.save(role);
  }

  async updateRole(
    id: string,
    input: { description?: string; permissions?: PermissionName[] },
  ): Promise<Role> {
    const role = await this.findRoleById(id);
    if (input.description !== undefined) role.description = input.description;
    if (input.permissions !== undefined) {
      role.permissions = await this.resolvePermissions(input.permissions);
    }
    const saved = await this.roles.save(role);
    await this.invalidateRoleHolders(id);
    return saved;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.findRoleById(id);
    if (role.isSystem)
      throw new BadRequestException('System roles cannot be deleted');
    await this.invalidateRoleHolders(id);
    await this.roles.remove(role);
  }

  findAllPermissions(): Promise<Permission[]> {
    return this.permissions.find({ order: { name: 'ASC' } });
  }

  private async resolvePermissions(
    names: PermissionName[],
  ): Promise<Permission[]> {
    const unknown = names.filter((n) => !ALL_PERMISSIONS.includes(n));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}`,
      );
    }
    if (names.length === 0) return [];
    return this.permissions.find({ where: { name: In(names) } });
  }
}
