import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './shared/database/prisma.module';
import { AuthModule } from './shared/auth/auth.module';
import { RbacModule } from './shared/rbac/rbac.module';
import { AuditModule } from './shared/audit/audit.module';
import { NotificationModule } from './shared/notifications/notification.module';
import { WorkflowEngineModule } from './shared/workflow/workflow-engine.module';

import { EmployeeModule } from './modules/employee/employee.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { LeaveModule } from './modules/leave/leave.module';
import { ShiftModule } from './modules/shift/shift.module';
import { HolidayModule } from './modules/holiday/holiday.module';
import { AtsModule } from './modules/ats/ats.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { AssetsModule } from './modules/assets/assets.module';
import { OffboardingModule } from './modules/offboarding/offboarding.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditModule as AuditFeatureModule } from './modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Cross-cutting layers (Section 10)
    PrismaModule,
    AuthModule,
    RbacModule,
    AuditModule,
    NotificationModule,
    WorkflowEngineModule,

    // Feature modules (Section 7)
    EmployeeModule,
    AttendanceModule,
    LeaveModule,
    ShiftModule,
    HolidayModule,
    AtsModule,
    OnboardingModule,
    PerformanceModule,
    AssetsModule,
    OffboardingModule,
    HelpdeskModule,
    AnnouncementsModule,
    AnalyticsModule,
    AssistantModule,
    WorkflowModule,
    NotificationsModule,
    SettingsModule,
    AuditFeatureModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
