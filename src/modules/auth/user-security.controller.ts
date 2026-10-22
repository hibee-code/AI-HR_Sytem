import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../audit/audit.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UsersService } from '../users/users.service';
import { MfaService } from './mfa.service';
import { TokenService } from './token.service';

/** Admin recovery for locked-out users. Lives here to avoid a users↔auth cycle. */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UserSecurityController {
  constructor(
    private readonly users: UsersService,
    private readonly mfa: MfaService,
    private readonly tokens: TokenService,
  ) {}

  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.USER_SUSPEND)
  @Audit('user.unlock', 'user')
  @ApiOperation({ summary: 'Clear a lockout after too many failed logins' })
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(id);
  }

  @Post(':id/mfa/reset')
  @RequirePermissions(PERMISSIONS.USER_SUSPEND)
  @Audit('user.mfa.reset', 'user')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Remove a user’s authenticator (lost device); signs them out everywhere',
  })
  async resetMfa(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.mfa.reset(id);
    await this.tokens.revokeAllForUser(id);
  }
}
