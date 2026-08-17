import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetStatus, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import type { EmployeeDataRequester } from '../../shared/employee/reporting-hierarchy.util';
import { CreateAssetDto } from './dto/create-asset.dto';
import { CreateAssetRequestDto } from './dto/create-asset-request.dto';
import { IssueAssetDto } from './dto/issue-asset.dto';
import { ReturnAssetDto } from './dto/return-asset.dto';

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
  ) {}

  async createAsset(dto: CreateAssetDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    return this.prisma.asset.create({
      data: {
        companyId,
        category: dto.category,
        make: dto.make,
        model: dto.model,
        serialNumber: dto.serialNumber,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        cost: dto.cost,
        warrantyExpiry: dto.warrantyExpiry
          ? new Date(dto.warrantyExpiry)
          : undefined,
      },
    });
  }

  listAssets(status?: AssetStatus) {
    return this.prisma.asset.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  private getActiveAssignment(assetId: string) {
    return this.prisma.assetAssignment.findFirst({
      where: { assetId, returnedAt: null },
    });
  }

  // Business Rule: asset request approval is HR Admin/Super Admin only —
  // the reporting manager is never the approver and is never notified,
  // regardless of who the employee reports to.
  async createAssetRequest(dto: CreateAssetRequestDto, actorId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    const request = await this.prisma.assetRequest.create({
      data: {
        employeeId: actorId,
        assetCategory: dto.assetCategory,
        justification: dto.justification,
      },
    });

    if (employee) {
      const approvers = await this.prisma.employee.findMany({
        where: {
          companyId: employee.companyId,
          role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        },
        select: { id: true },
      });
      await Promise.all(
        approvers.map((approver) =>
          this.notifications.send({
            recipientId: approver.id,
            template: 'assets.request-pending-approval',
            body: `${employee.firstName} ${employee.lastName} requested a ${dto.assetCategory} asset and is awaiting your approval.`,
            data: { requestId: request.id },
          }),
        ),
      );
    }
    return request;
  }

  // Non-privileged callers can't trust their own employeeId query param —
  // it's overridden to the caller's own id so one employee can't read
  // another's asset requests. There's no approver-scoped view anymore:
  // approval is HR Admin/Super Admin only, and they can already see every
  // request.
  listAssetRequests(
    filter: { employeeId?: string },
    requester: EmployeeDataRequester,
  ) {
    const employeeId = isPrivileged(requester.role)
      ? filter.employeeId
      : requester.userId;
    return this.prisma.assetRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decideAssetRequest(
    requestId: string,
    approve: boolean,
    actorId: string,
    actorRole?: Role,
  ) {
    if (!isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only HR Admin or Super Admin can decide an asset request',
      );
    }
    const request = await this.prisma.assetRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Asset request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request was already decided');
    }

    return this.prisma.assetRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedAt: new Date(),
      },
    });
  }

  // Section 7.9 Acceptance Criteria: "An asset cannot show two active
  // custodians simultaneously" — reassigning auto-closes the prior custody
  // record rather than requiring a manual return first.
  async issueAsset(assetId: string, dto: IssueAssetDto) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    const existingActive = await this.getActiveAssignment(assetId);

    await this.prisma.$transaction([
      ...(existingActive
        ? [
            this.prisma.assetAssignment.update({
              where: { id: existingActive.id },
              data: { returnedAt: new Date(), returnCondition: 'TRANSFERRED' },
            }),
          ]
        : []),
      this.prisma.assetAssignment.create({
        data: { assetId, employeeId: dto.employeeId },
      }),
      this.prisma.asset.update({
        where: { id: assetId },
        data: { status: AssetStatus.PENDING_HANDOVER },
      }),
    ]);

    await this.notifications.send({
      recipientId: dto.employeeId,
      template: 'assets.issued-pending-acknowledgement',
      body: `A ${asset.category}${asset.model ? ` (${asset.model})` : ''} has been issued to you and is awaiting your acknowledgement.`,
      data: { assetId },
    });

    return this.prisma.assetAssignment.findFirstOrThrow({
      where: { assetId, employeeId: dto.employeeId, returnedAt: null },
      orderBy: { issuedAt: 'desc' },
    });
  }

  // Section 7.9 Acceptance Criteria: "Asset issue requires recorded
  // employee acknowledgement" before it counts as truly Issued.
  async acknowledgeAsset(assignmentId: string, actorId: string) {
    const assignment = await this.prisma.assetAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.employeeId !== actorId) {
      throw new ForbiddenException(
        'Only the receiving employee can acknowledge this asset',
      );
    }
    if (assignment.returnedAt) {
      throw new BadRequestException('This assignment has already ended');
    }

    const [updatedAssignment] = await this.prisma.$transaction([
      this.prisma.assetAssignment.update({
        where: { id: assignmentId },
        data: { acknowledgedAt: new Date() },
      }),
      this.prisma.asset.update({
        where: { id: assignment.assetId },
        data: { status: AssetStatus.ISSUED },
      }),
    ]);
    return updatedAssignment;
  }

  // Section 7.9 Representative API: "POST /api/v1/assets/{id}/return —
  // Process return" — keyed by the asset, not the assignment, since that's
  // what HR/IT actually has in hand; resolves to whichever custody record
  // is currently active.
  async returnAsset(assetId: string, dto: ReturnAssetDto) {
    const assignment = await this.getActiveAssignment(assetId);
    if (!assignment) {
      throw new BadRequestException(
        'This asset has no active custodian to return from',
      );
    }

    const condition = dto.condition ?? 'GOOD';
    const [updatedAssignment] = await this.prisma.$transaction([
      this.prisma.assetAssignment.update({
        where: { id: assignment.id },
        data: {
          returnedAt: new Date(),
          returnCondition: condition,
        },
      }),
      this.prisma.asset.update({
        where: { id: assetId },
        data: { status: AssetStatus.AVAILABLE, condition },
      }),
    ]);
    return updatedAssignment;
  }

  getEmployeeAssignments(employeeId: string) {
    return this.prisma.assetAssignment.findMany({
      where: { employeeId },
      include: { asset: true },
      orderBy: { issuedAt: 'desc' },
    });
  }

  // Consumed by OffboardingService (Section 7.10 Business Rule: "Offboarding's
  // IT Clearance step is blocked until every asset ... is marked
  // returned/transferred").
  async hasUnreturnedAssets(employeeId: string): Promise<boolean> {
    const count = await this.prisma.assetAssignment.count({
      where: { employeeId, returnedAt: null },
    });
    return count > 0;
  }

  // Consumed by OffboardingService's F&F calculation (Section 7.10 Business
  // Rule: "unreturned/damaged asset cost ... from the Asset module").
  async getRecoverableAssetCost(employeeId: string): Promise<number> {
    const assignments = await this.prisma.assetAssignment.findMany({
      where: {
        employeeId,
        OR: [{ returnedAt: null }, { returnCondition: 'DAMAGED' }],
      },
      include: { asset: true },
    });
    return assignments.reduce((sum, a) => sum + (a.asset.cost ?? 0), 0);
  }
}
