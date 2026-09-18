import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UsersService } from '../users/users.service';
import {
  ListNotificationLogDto,
  UpdatePreferencesDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  @Get('preferences/me')
  @ApiOperation({ summary: 'My delivery preferences' })
  getMyPreferences(@CurrentUser('id') userId: string) {
    return this.notifications.getPreferences(userId);
  }

  @Put('preferences/me')
  @ApiOperation({ summary: 'Update my delivery preferences' })
  updateMyPreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notifications.updatePreferences(userId, dto);
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_SEND_TEST)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a test email + Slack DM to yourself' })
  async sendTest(@CurrentUser() actor: AuthUser) {
    const user = await this.users.findById(actor.id);
    const logIds = await this.notifications.notify({
      template: 'TEST',
      to: { userId: actor.id },
      data: { firstName: user.firstName },
    });
    return { queued: logIds };
  }

  @Get('log')
  @RequirePermissions(PERMISSIONS.NOTIFICATION_READ_LOG)
  @ApiOperation({ summary: 'Delivery log (paginated, filterable)' })
  listLog(@Query() query: ListNotificationLogDto) {
    return this.notifications.listLog(query);
  }
}
