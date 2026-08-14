import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { GRANTABLE_MODULES, type GrantableModule } from './module-access.constants';

@Injectable()
export class ModuleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  listModules() {
    return GRANTABLE_MODULES;
  }

  async grant(employeeId: string, module: GrantableModule, actorId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.moduleAccessGrant.upsert({
      where: { employeeId_module: { employeeId, module } },
      // Already granted — re-granting is a no-op on the grant itself, but
      // still worth recording who most recently confirmed it.
      update: { grantedBy: actorId },
      create: { employeeId, module, grantedBy: actorId },
    });
  }

  async revoke(employeeId: string, module: string) {
    if (!GRANTABLE_MODULES.includes(module as GrantableModule)) {
      throw new BadRequestException(`Unknown module: ${module}`);
    }
    await this.prisma.moduleAccessGrant.deleteMany({
      where: { employeeId, module },
    });
    return { revoked: true };
  }

  listForEmployee(employeeId: string) {
    return this.prisma.moduleAccessGrant.findMany({
      where: { employeeId },
      orderBy: { module: 'asc' },
    });
  }
}
