import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { ListAuditLogsQueryDto } from './dto/audit.dto';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
    private readonly logger: Logger,
  ) {}

  /**
   * Never throws: the audited action has already happened, so a failed
   * write is logged loudly instead of failing the caller's request.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          actorUserId: entry.actorUserId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 512) ?? null,
          metadata: entry.metadata ?? {},
        }),
      );
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message, entry },
        'audit log write failed',
      );
    }
  }

  async list(
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResponse<AuditLog>> {
    const where: FindOptionsWhere<AuditLog> = {
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      ...(query.action && { action: query.action }),
      ...(query.resourceType && { resourceType: query.resourceType }),
      ...(query.resourceId && { resourceId: query.resourceId }),
    };
    if (query.from && query.to)
      where.createdAt = Between(new Date(query.from), new Date(query.to));
    else if (query.from)
      where.createdAt = MoreThanOrEqual(new Date(query.from));
    else if (query.to) where.createdAt = LessThanOrEqual(new Date(query.to));

    const [data, total] = await this.logs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return new PaginatedResponse(data, total, query);
  }
}
