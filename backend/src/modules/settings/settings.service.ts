import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

// Section 7.17 Key Features: org structure configuration covers four unit
// types, each mapping 1:1 to an existing Prisma model that, until now, was
// only ever read via Employee's getReferenceData() (seeded, never admin-
// managed) — Settings is where they become manageable.
type OrgUnitType = 'department' | 'location' | 'designation' | 'grade';
const ORG_UNIT_TYPES: OrgUnitType[] = [
  'department',
  'location',
  'designation',
  'grade',
];

function assertValidOrgUnitType(type: string): asserts type is OrgUnitType {
  if (!ORG_UNIT_TYPES.includes(type as OrgUnitType)) {
    throw new BadRequestException(`Unknown org structure type "${type}"`);
  }
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
  ) {}

  // Section 7.17 Data Entities: "CompanySettings" — created with sane
  // defaults on first read, same "configurable override, built-in default"
  // shape as TicketSlaPolicy/DEFAULT_SLA_HOURS.
  async getCompanySettings() {
    const companyId = await this.defaultCompany.getOrCreate();
    const existing = await this.prisma.companySettings.findUnique({
      where: { companyId },
    });
    if (existing) return existing;
    return this.prisma.companySettings.create({ data: { companyId } });
  }

  async updateCompanySettings(dto: UpdateCompanySettingsDto) {
    const companyId = await this.defaultCompany.getOrCreate();
    return this.prisma.companySettings.upsert({
      where: { companyId },
      update: dto,
      create: { companyId, ...dto },
    });
  }

  async listOrgStructure() {
    const companyId = await this.defaultCompany.getOrCreate();
    const [departments, locations, designations, grades] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId } }),
      this.prisma.location.findMany({ where: { companyId } }),
      this.prisma.designation.findMany({ where: { companyId } }),
      this.prisma.grade.findMany({ where: { companyId } }),
    ]);
    return { departments, locations, designations, grades };
  }

  // The four org-unit models are structurally near-identical (companyId,
  // name, code, isActive, employees[]) apart from Department's extra
  // self-relation — dispatching to the right delegate by type avoids four
  // near-duplicate create/update methods. The `any` cast is confined to this
  // one lookup rather than spreading through the calling methods.
  private delegateFor(type: OrgUnitType) {
    switch (type) {
      case 'department':
        return this.prisma.department;
      case 'location':
        return this.prisma.location;
      case 'designation':
        return this.prisma.designation;
      case 'grade':
        return this.prisma.grade;
    }
  }

  async createOrgUnit(type: string, dto: CreateOrgUnitDto) {
    assertValidOrgUnitType(type);
    const companyId = await this.defaultCompany.getOrCreate();
    const delegate = this.delegateFor(type) as unknown as {
      create: (args: { data: Prisma.InputJsonObject }) => Promise<unknown>;
    };
    return delegate.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code,
        ...(type === 'department' && dto.parentId
          ? { parentId: dto.parentId }
          : {}),
      },
    });
  }

  // Section 7.17 Business Rule: "deactivating an org unit with active
  // employees requires explicit confirmation and preserves history rather
  // than deleting" — force must be set to actually flip isActive to false
  // when employees are still attached; the row itself is never deleted.
  async updateOrgUnit(type: string, id: string, dto: UpdateOrgUnitDto) {
    assertValidOrgUnitType(type);
    const delegate = this.delegateFor(type) as unknown as {
      findUnique: (args: {
        where: { id: string };
        include: { employees: true };
      }) => Promise<{ isActive: boolean; employees: unknown[] } | null>;
      update: (args: {
        where: { id: string };
        data: Prisma.InputJsonObject;
      }) => Promise<unknown>;
    };

    const existing = await delegate.findUnique({
      where: { id },
      include: { employees: true },
    });
    if (!existing) throw new NotFoundException(`${type} not found`);

    if (dto.isActive === false && existing.isActive !== false) {
      const activeEmployeeCount = existing.employees.length;
      if (activeEmployeeCount > 0 && !dto.force) {
        throw new BadRequestException(
          `${activeEmployeeCount} employee(s) are still assigned to this ${type}; pass force to deactivate anyway`,
        );
      }
    }

    return delegate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(type === 'department' &&
          dto.parentId !== undefined && { parentId: dto.parentId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  // Section 7.17 Data Entities: "IntegrationConfig" — every integration type
  // is always surfaced, even before it's been touched, so the Settings
  // screen has a full status board from day one rather than an empty list.
  async listIntegrations() {
    const companyId = await this.defaultCompany.getOrCreate();
    const existing = await this.prisma.integrationConfig.findMany({
      where: { companyId },
    });
    const byType = new Map(existing.map((row) => [row.type, row]));
    return Object.values(IntegrationType).map(
      (type) =>
        byType.get(type) ?? {
          companyId,
          type,
          status: 'NOT_CONFIGURED' as const,
          metadata: null,
        },
    );
  }

  async updateIntegration(type: string, dto: UpdateIntegrationDto) {
    if (!Object.values(IntegrationType).includes(type as IntegrationType)) {
      throw new BadRequestException(`Unknown integration type "${type}"`);
    }
    const companyId = await this.defaultCompany.getOrCreate();
    const integrationType = type as IntegrationType;
    return this.prisma.integrationConfig.upsert({
      where: { companyId_type: { companyId, type: integrationType } },
      update: {
        status: dto.status,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
      create: {
        companyId,
        type: integrationType,
        status: dto.status,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // Pilot-launch basic backup: an application-level export (every row of
  // every table, keyed by model name), not a native pg_dump — this avoids
  // depending on a pg_dump binary matching the server's exact Postgres
  // version, at the cost of only being restorable into this same schema
  // (via a matching import, not `psql`). Iterates Prisma's own DMMF model
  // list rather than a hardcoded array, so a newly added model is included
  // automatically instead of silently missing from every future backup.
  // Deliberately keeps passwordHash and every other field intact — the
  // whole point of a backup is complete restorability, not display, so the
  // normal "never leak passwordHash" rule doesn't apply here. The caller
  // (Super Admin only, see SettingsController) is responsible for storing
  // the downloaded file securely.
  async exportBackup(): Promise<{ createdAt: string; data: Record<string, unknown[]> }> {
    const modelNames = Prisma.dmmf.datamodel.models.map((m) => m.name);
    const data: Record<string, unknown[]> = {};
    for (const modelName of modelNames) {
      const accessor = modelName.charAt(0).toLowerCase() + modelName.slice(1);
      const delegate = (this.prisma as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>)[accessor];
      if (typeof delegate?.findMany !== 'function') continue;
      data[modelName] = await delegate.findMany();
    }
    return { createdAt: new Date().toISOString(), data };
  }
}
