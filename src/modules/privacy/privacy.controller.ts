import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../audit/audit.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';

/** NDPA data-subject requests and retention. */
@ApiTags('privacy')
@ApiBearerAuth('access-token')
@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly retention: RetentionService,
  ) {}

  @Get('me/export')
  @Audit('privacy.export.self', 'user')
  @ApiOperation({
    summary: 'Download everything the system holds about you (JSON)',
  })
  exportMine(@CurrentUser('id') userId: string) {
    return this.privacy.exportUser(userId);
  }

  @Get('employees/:id/export')
  @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE)
  @Audit('privacy.export', 'employee')
  @ApiOperation({ summary: "An employee's data-subject export (JSON)" })
  exportEmployee(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.exportEmployee(id);
  }

  @Get('candidates/:id/export')
  @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE)
  @Audit('privacy.export', 'candidate')
  @ApiOperation({ summary: "A job applicant's data-subject export (JSON)" })
  exportCandidate(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.exportCandidate(id);
  }

  @Delete('candidates/:id')
  @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE)
  @Audit('privacy.erase', 'candidate')
  @ApiOperation({
    summary:
      'Erase an applicant: applications, résumé files and the candidate record, permanently',
  })
  eraseCandidate(@Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.eraseCandidate(id);
  }

  @Post('retention/run')
  @RequirePermissions(PERMISSIONS.PRIVACY_MANAGE)
  @Audit('privacy.retention.run', 'system')
  @ApiOperation({ summary: 'Run the retention purge now (normally daily)' })
  runRetention() {
    return this.retention.run();
  }
}
