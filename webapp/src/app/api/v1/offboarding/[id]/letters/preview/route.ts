import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as offboardingService from "@/server/modules/offboarding/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ params }) => {
  const pdf = await offboardingService.previewRelievingLetter(prisma, params.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relieving-letter-${params.id}.pdf"`,
    },
  });
});
