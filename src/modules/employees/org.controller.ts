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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { DepartmentsService } from './departments.service';
import {
  CreateDepartmentDto,
  CreatePositionDto,
  UpdateDepartmentDto,
  UpdatePositionDto,
} from './dto/department.dto';
import { PositionsService } from './positions.service';

/** Departments and positions: the static shape of the organisation. */
@ApiTags('organisation')
@ApiBearerAuth('access-token')
@Controller()
export class OrgController {
  constructor(
    private readonly departments: DepartmentsService,
    private readonly positions: PositionsService,
  ) {}

  // ── Departments ───────────────────────────────────────────────────────

  @Get('departments')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_READ)
  @ApiOperation({ summary: 'Flat list of departments' })
  listDepartments() {
    return this.departments.findAll();
  }

  @Get('departments/tree')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_READ)
  @ApiOperation({ summary: 'Department org chart with heads and headcounts' })
  departmentTree() {
    return this.departments.tree();
  }

  @Get('departments/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_READ)
  getDepartment(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.findById(id);
  }

  @Post('departments')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_MANAGE)
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.departments.create(dto);
  }

  @Patch('departments/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_MANAGE)
  updateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(id, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty leaf department' })
  deleteDepartment(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.remove(id);
  }

  // ── Positions ─────────────────────────────────────────────────────────

  @Get('positions')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_READ)
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listPositions(
    @Query('departmentId') departmentId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.positions.findAll({
      departmentId,
      includeInactive: includeInactive === 'true',
    });
  }

  @Get('positions/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_READ)
  getPosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.positions.findById(id);
  }

  @Post('positions')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_MANAGE)
  createPosition(@Body() dto: CreatePositionDto) {
    return this.positions.create(dto);
  }

  @Patch('positions/:id')
  @RequirePermissions(PERMISSIONS.DEPARTMENT_MANAGE)
  @ApiOperation({ summary: 'Update or deactivate (isActive=false) a position' })
  updatePosition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePositionDto,
  ) {
    return this.positions.update(id, dto);
  }
}
