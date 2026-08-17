import { RequestCommentType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Shared by the WFO/WFH change, Comp-Off, and Overtime services: a Super
// Admin oversight comment directed at the assigned manager, never visible
// to the requesting employee. requestType/requestId is a loose reference
// (not a hard FK) so one row shape covers all three request tables.
export async function addSuperAdminComment(
  prisma: PrismaService,
  params: {
    requestType: RequestCommentType;
    requestId: string;
    authorId: string;
    body: string;
  },
) {
  return prisma.superAdminRequestComment.create({ data: params });
}

export async function listSuperAdminComments(
  prisma: PrismaService,
  requestType: RequestCommentType,
  requestId: string,
) {
  return prisma.superAdminRequestComment.findMany({
    where: { requestType, requestId },
    orderBy: { createdAt: 'asc' },
  });
}
