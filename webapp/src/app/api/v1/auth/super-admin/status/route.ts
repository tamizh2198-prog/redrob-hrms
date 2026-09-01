import { withRoute } from "@/server/lib/route";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  return Response.json({ ok: true, message: "Super Admin access confirmed" });
});
