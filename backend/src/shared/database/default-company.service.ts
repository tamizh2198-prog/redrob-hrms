import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class DefaultCompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(): Promise<string> {
    const existing = await this.prisma.company.findFirst();
    if (existing) return existing.id;
    const created = await this.prisma.company.create({
      data: { name: 'Default Company' },
    });
    return created.id;
  }
}
