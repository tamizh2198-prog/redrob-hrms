import { NextRequest } from "next/server";
import { UnauthorizedError, ForbiddenError } from "./errors";

jest.mock("./auth", () => ({
  verifyAccessToken: jest.fn(),
}));
jest.mock("./prisma", () => ({
  prisma: { moduleAccessGrant: { findUnique: jest.fn() } },
}));

import { checkAuthorization } from "./route";
import { verifyAccessToken } from "./auth";
import { prisma } from "./prisma";

function makeRequest(opts: { cookie?: string; authorization?: string }) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.authorization) headers.set("authorization", opts.authorization);
  return new NextRequest("http://localhost/api/v1/x", { headers });
}

describe("checkAuthorization (HRMS-06: httpOnly session cookie)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns null for public routes without checking any token", async () => {
    const user = await checkAuthorization(makeRequest({}), { public: true });
    expect(user).toBeNull();
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("accepts a valid access_token cookie", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ userId: "emp-1", role: "EMPLOYEE" });
    const user = await checkAuthorization(makeRequest({ cookie: "access_token=cookie-token" }), {});
    expect(user).toEqual({ userId: "emp-1", role: "EMPLOYEE" });
    expect(verifyAccessToken).toHaveBeenCalledWith("cookie-token");
  });

  it("falls back to the Authorization header when no cookie is present (e.g. dev-login/curl)", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ userId: "emp-2", role: "SUPER_ADMIN" });
    const user = await checkAuthorization(makeRequest({ authorization: "Bearer header-token" }), {});
    expect(user).toEqual({ userId: "emp-2", role: "SUPER_ADMIN" });
    expect(verifyAccessToken).toHaveBeenCalledWith("header-token");
  });

  it("prefers the cookie over the header when both are present", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ userId: "emp-1", role: "EMPLOYEE" });
    await checkAuthorization(
      makeRequest({ cookie: "access_token=cookie-token", authorization: "Bearer header-token" }),
      {},
    );
    expect(verifyAccessToken).toHaveBeenCalledWith("cookie-token");
  });

  it("throws UnauthorizedError when neither cookie nor header is present", async () => {
    await expect(checkAuthorization(makeRequest({}), {})).rejects.toThrow(UnauthorizedError);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when the token fails verification (expired/forged/wrong type)", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue(null);
    await expect(checkAuthorization(makeRequest({ cookie: "access_token=bad" }), {})).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("throws ForbiddenError when the role isn't allowed and there's no module grant", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ userId: "emp-1", role: "EMPLOYEE" });
    (prisma.moduleAccessGrant.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      checkAuthorization(makeRequest({ cookie: "access_token=cookie-token" }), { roles: ["SUPER_ADMIN" as never] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows a disallowed role through via a module grant", async () => {
    (verifyAccessToken as jest.Mock).mockReturnValue({ userId: "emp-1", role: "EMPLOYEE" });
    (prisma.moduleAccessGrant.findUnique as jest.Mock).mockResolvedValue({ id: "grant-1" });
    const user = await checkAuthorization(makeRequest({ cookie: "access_token=cookie-token" }), {
      roles: ["SUPER_ADMIN" as never],
      module: "payroll",
    });
    expect(user).toEqual({ userId: "emp-1", role: "EMPLOYEE" });
  });
});
