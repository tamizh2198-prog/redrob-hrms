import { PrismaClient } from "@prisma/client";

// Standard Next.js + Prisma singleton pattern: dev-mode hot-reload would
// otherwise create a fresh PrismaClient (and a fresh connection pool) on
// every file save, eventually exhausting Supabase's connection limit.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
