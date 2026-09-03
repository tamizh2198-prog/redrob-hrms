import type { PrismaClient } from "@prisma/client";
import * as authService from "./service";

function createMockPrisma() {
  return {
    employee: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    rateLimitAttempt: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
  };
}

jest.mock("../../lib/auth", () => ({
  verifyPassword: jest.fn(),
  isTrustedDevice: jest.fn().mockResolvedValue(false),
  generateMfaSecret: jest.fn().mockReturnValue("secret"),
  buildMfaEnrollment: jest.fn().mockResolvedValue({ secret: "secret", qrCodeDataUrl: "data:image/png;base64,x" }),
  signMagicLink: jest.fn().mockReturnValue("magic-link-token"),
  verifyMagicLink: jest.fn(),
  verifyMfaCode: jest.fn(),
  issueSession: jest.fn().mockResolvedValue({ accessToken: "access-token", refreshToken: "refresh-token" }),
  issueTrustedDevice: jest.fn().mockResolvedValue("device-token"),
  toUserView: jest.fn((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, role: e.role })),
  rotateRefreshToken: jest.fn(),
  signAccessToken: jest.fn().mockReturnValue("new-access-token"),
}));

describe("auth service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;
  let authLib: {
    verifyPassword: jest.Mock;
    verifyMagicLink: jest.Mock;
    verifyMfaCode: jest.Mock;
    rotateRefreshToken: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    authLib = jest.requireMock("../../lib/auth");
  });

  describe("Rate limiting (HRMS-05): login", () => {
    it("rejects credential checking once the login rate limit is reached for this email", async () => {
      prisma.rateLimitAttempt.count.mockResolvedValue(5);

      await expect(
        authService.login(db, { email: "gaurav@example.com", password: "wrong" } as never),
      ).rejects.toThrow("Too many requests");
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it("records a rate-limit attempt on a wrong password but not on success", async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: "emp-1",
        passwordHash: "hash",
        role: "EMPLOYEE",
        status: "ACTIVE",
      });
      authLib.verifyPassword.mockResolvedValue(false);

      await expect(
        authService.login(db, { email: "gaurav@example.com", password: "wrong" } as never),
      ).rejects.toThrow("Invalid email or password");
      expect(prisma.rateLimitAttempt.create).toHaveBeenCalledWith({ data: { key: "login:gaurav@example.com" } });
    });

    it("does not record an attempt on a successful login", async () => {
      prisma.employee.findFirst.mockResolvedValue({
        id: "emp-1",
        passwordHash: "hash",
        role: "EMPLOYEE",
        status: "ACTIVE",
        firstName: "Gaurav",
        lastName: "Bisht",
      });
      authLib.verifyPassword.mockResolvedValue(true);

      const result = await authService.login(db, { email: "gaurav@example.com", password: "correct" } as never);
      expect(result.status).toBe("OK");
      expect(prisma.rateLimitAttempt.create).not.toHaveBeenCalled();
    });
  });

  describe("Rate limiting (HRMS-05): MFA verify", () => {
    it("rejects once the MFA rate limit is reached for this employee", async () => {
      authLib.verifyMagicLink.mockReturnValue({ sub: "emp-1" });
      prisma.rateLimitAttempt.count.mockResolvedValue(5);

      await expect(authService.verifyMfa(db, { mfaToken: "t", code: "000000" } as never)).rejects.toThrow(
        "Too many requests",
      );
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it("records an attempt on a wrong code", async () => {
      authLib.verifyMagicLink.mockReturnValue({ sub: "emp-1" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", mfaEnabled: true, mfaSecret: "s" });
      authLib.verifyMfaCode.mockReturnValue(false);

      await expect(authService.verifyMfa(db, { mfaToken: "t", code: "000000" } as never)).rejects.toThrow(
        "Invalid MFA code",
      );
      expect(prisma.rateLimitAttempt.create).toHaveBeenCalledWith({ data: { key: "mfa:emp-1" } });
    });
  });

  describe("Session revocation on exit (HRMS-01): refreshSession", () => {
    it("rejects refreshing a terminated employee's still-valid token", async () => {
      authLib.rotateRefreshToken.mockResolvedValue({ employeeId: "emp-1", token: "new-refresh-token" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", role: "EMPLOYEE", status: "TERMINATED" });

      await expect(authService.refreshSession(db, "old-refresh-token")).rejects.toThrow(
        "This account no longer has access",
      );
    });

    it("rejects refreshing an archived employee's still-valid token", async () => {
      authLib.rotateRefreshToken.mockResolvedValue({ employeeId: "emp-1", token: "new-refresh-token" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", role: "EMPLOYEE", status: "ARCHIVED" });

      await expect(authService.refreshSession(db, "old-refresh-token")).rejects.toThrow(
        "This account no longer has access",
      );
    });

    it("issues a fresh access token for an active employee", async () => {
      authLib.rotateRefreshToken.mockResolvedValue({ employeeId: "emp-1", token: "new-refresh-token" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", role: "EMPLOYEE", status: "ACTIVE" });

      const result = await authService.refreshSession(db, "old-refresh-token");
      expect(result).toEqual({ accessToken: "new-access-token", refreshToken: "new-refresh-token" });
    });
  });
});
