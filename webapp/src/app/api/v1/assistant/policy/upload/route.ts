import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UploadPolicyDocumentDto } from "@/server/modules/assistant/dto";
import * as assistantService from "@/server/modules/assistant/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"], dto: UploadPolicyDocumentDto }, async ({ user, body }) => {
  const result = await assistantService.uploadPolicyDocument(prisma, body, user!.userId);
  return Response.json(result);
});
