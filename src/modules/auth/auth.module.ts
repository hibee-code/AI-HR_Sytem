import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../rbac/rbac.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OneTimeToken } from './entities/one-time-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MfaService } from './mfa.service';
import { TokenService } from './token.service';
import { UserSecurityController } from './user-security.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, OneTimeToken]),
    // Secrets/expiry are passed per call in TokenService so access and refresh
    // can never accidentally share a secret.
    JwtModule.register({}),
    UsersModule,
    RbacModule,
  ],
  controllers: [AuthController, UserSecurityController],
  providers: [AuthService, TokenService, MfaService, JwtAuthGuard],
  exports: [AuthService, TokenService, MfaService, JwtAuthGuard],
})
export class AuthModule {}
