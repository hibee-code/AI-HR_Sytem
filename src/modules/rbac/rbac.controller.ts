import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { PERMISSIONS } from './permissions.catalogue';
import { RbacService } from './rbac.service';
import { Audit } from '../audit/audit.decorator';

@ApiTags('rbac')
@ApiBearerAuth('access-token')
@Controller()
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'List the permission catalogue' })
  listPermissions() {
    return this.rbac.findAllPermissions();
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({ summary: 'List roles with their permissions' })
  listRoles() {
    return this.rbac.findAllRoles();
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  getRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.findRoleById(id);
  }

  @Audit('role.create', 'role', { bodyKeys: ['name', 'permissions'] })
  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Create a custom role' })
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.createRole(dto);
  }

  @Audit('role.update', 'role', { bodyKeys: ['description', 'permissions'] })
  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({
    summary: 'Update description / permissions (system roles included)',
  })
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rbac.updateRole(id, dto);
  }

  @Audit('role.delete', 'role')
  @Delete('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom role (system roles refused)' })
  deleteRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.deleteRole(id);
  }
}
