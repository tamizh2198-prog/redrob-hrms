import { Module } from '@nestjs/common';
import { ModuleAccessController } from './module-access.controller';
import { ModuleAccessService } from './module-access.service';

@Module({
  controllers: [ModuleAccessController],
  providers: [ModuleAccessService],
})
export class ModuleAccessModule {}
