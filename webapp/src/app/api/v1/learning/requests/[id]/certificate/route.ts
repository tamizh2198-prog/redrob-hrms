import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitCertificateDto } from "@/server/modules/learning/dto";
import * as learningService from "@/server/modules/learning/service";

export const POST = withRoute({ dto: SubmitCertificateDto }, async ({ user, params, body }) => {
  const result = await learningService.submitCertificate(prisma, params.id, user!.userId, body.certificateRef);
  return Response.json(result);
});
