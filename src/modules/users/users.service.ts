import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { RbacService } from '../rbac/rbac.service';
import { ListUsersQueryDto } from './dto/user.dto';
import { User, UserStatus } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly rbac: RbacService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email }, relations: { roles: true } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id },
      relations: { roles: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<User>> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.roles', 'r')
      .orderBy('u.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (query.status)
      qb.andWhere('u.status = :status', { status: query.status });
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.email ILIKE :s')
            .orWhere('u.firstName ILIKE :s')
            .orWhere('u.lastName ILIKE :s');
        }),
        { s: `%${query.search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  /**
   * Creates an INVITED user with no password. The caller (AuthService) issues
   * the invite token; this method only owns the user record.
   */
  async createInvited(input: {
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  }): Promise<User> {
    const existing = await this.users.findOne({
      where: { email: input.email },
      withDeleted: true,
    });
    if (existing)
      throw new ConflictException('A user with this email already exists');

    const roles = await this.rbac.findRolesByNames(input.roles);
    const user = this.users.create({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      status: UserStatus.INVITED,
      passwordHash: null,
      roles,
    });
    return this.users.save(user);
  }

  async updateProfile(
    id: string,
    input: { firstName?: string; lastName?: string },
  ): Promise<User> {
    const user = await this.findById(id);
    if (input.firstName !== undefined) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    return this.users.save(user);
  }

  async setRoles(id: string, roleNames: string[]): Promise<User> {
    const user = await this.findById(id);
    user.roles = await this.rbac.findRolesByNames(roleNames);
    const saved = await this.users.save(user);
    await this.rbac.invalidateAuthUser(id);
    return saved;
  }

  async setStatus(
    id: string,
    status: UserStatus.ACTIVE | UserStatus.SUSPENDED,
    actorId: string,
  ): Promise<User> {
    if (id === actorId)
      throw new BadRequestException('You cannot change your own status');
    const user = await this.findById(id);
    if (user.status === UserStatus.INVITED && status === UserStatus.ACTIVE) {
      throw new BadRequestException(
        'User must accept their invite to become active',
      );
    }
    user.status = status;
    const saved = await this.users.save(user);
    await this.rbac.invalidateAuthUser(id);
    return saved;
  }

  /**
   * Atomic so parallel guesses can't race past the limit: bumps the counter
   * and, on reaching `maxAttempts`, locks the account and resets the counter.
   * Returns the lock expiry when this attempt triggered the lock.
   */
  async recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<Date | null> {
    const res: unknown = await this.users.query(
      `UPDATE users SET
         locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                             THEN now() + make_interval(mins => $3) ELSE locked_until END,
         failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2
                                      THEN 0 ELSE failed_login_attempts + 1 END
       WHERE id = $1
       RETURNING locked_until, failed_login_attempts`,
      [id, maxAttempts, lockMinutes],
    );
    // UPDATE … RETURNING comes back as [rows, rowCount] from the pg driver.
    const rows = (
      Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res
    ) as {
      locked_until: Date | null;
      failed_login_attempts: number;
    }[];
    const row = rows[0];
    return row && row.failed_login_attempts === 0 ? row.locked_until : null;
  }

  async unlock(id: string): Promise<User> {
    const user = await this.findById(id);
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    return this.users.save(user);
  }

  /** Persist a successful login / password change without re-validating roles. */
  async save(user: User): Promise<User> {
    return this.users.save(user);
  }
}
