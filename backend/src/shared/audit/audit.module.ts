import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditModule as AuditFeatureModule } from '../../modules/audit/audit.module';

@Module({
  imports: [AuditFeatureModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AuditModule {}
