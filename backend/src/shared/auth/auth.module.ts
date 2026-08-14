import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import { MagicLinkService } from './magic-link.service';
import { MfaService } from './mfa.service';
import { RefreshTokenService } from './refresh-token.service';
import { TrustedDeviceService } from './trusted-device.service';
import { EmployeeModule } from '../../modules/employee/employee.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    // Auth Phase 2: activation endpoints live on AuthController (public,
    // token-authorized) but the invitation/activation logic itself lives on
    // EmployeeService, which already owns the Employee/EmployeeInvitation
    // tables.
    EmployeeModule,
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    MagicLinkService,
    MfaService,
    RefreshTokenService,
    TrustedDeviceService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtModule, MagicLinkService, RefreshTokenService],
})
export class AuthModule {}
