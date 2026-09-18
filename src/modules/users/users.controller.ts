import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  ListUsersQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * Admin-side user management. Inviting lives in AuthController
 * (POST /auth/invite) because it issues a one-time token.
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USER_READ)
  @ApiOperation({ summary: 'List users (paginated, filterable)' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USER_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USER_UPDATE)
  @ApiOperation({ summary: 'Update name fields' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateProfile(id, dto);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.USER_MANAGE_ROLES)
  @ApiOperation({ summary: 'Replace the user’s role set' })
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.users.setRoles(id, dto.roles);
  }

  @Put(':id/status')
  @RequirePermissions(PERMISSIONS.USER_SUSPEND)
  @ApiOperation({ summary: 'Suspend or reactivate a user' })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setStatus(id, dto.status, actor.id);
  }
}
