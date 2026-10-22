import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/audit.dto';
import { AuditLog } from './entities/audit-log.entity';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';

@ApiTags('audit')
@ApiBearerAuth('access-token')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Search the audit trail (newest first)' })
  @ApiPaginatedResponse(AuditLog)
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.audit.list(query);
  }
}
