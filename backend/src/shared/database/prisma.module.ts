import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DefaultCompanyService } from './default-company.service';

@Global()
@Module({
  providers: [PrismaService, DefaultCompanyService],
  exports: [PrismaService, DefaultCompanyService],
})
export class PrismaModule {}
