import jwt from "jsonwebtoken";
import { signAccessToken, verifyAccessToken, signMagicLink } from "./auth";

describe("auth: access-token type confusion (HRMS-02)", () => {
  it("round-trips a normally-issued access token", () => {
    const token = signAccessToken({ sub: "emp-1", role: "EMPLOYEE" });
    const decoded = verifyAccessToken(token);
    expect(decoded).toEqual({ userId: "emp-1", role: "EMPLOYEE" });
  });

  it("rejects a magic-link token presented as an access token", () => {
    // Same secret, same sub shape as a real access token, but issued as a
    // magic link (e.g. the 30-day preboarding-portal link) — this is the
    // exact confusion the `type: "access"` claim exists to prevent.
    const magicLink = signMagicLink({ sub: "emp-1", purpose: "preboarding-portal" }, "30d");
    expect(verifyAccessToken(magicLink)).toBeNull();
  });

  it("rejects a token with no type claim at all, even if otherwise well-formed", () => {
    const secret = process.env.JWT_ACCESS_SECRET!;
    const bareToken = jwt.sign({ sub: "emp-1", role: "SUPER_ADMIN" }, secret, { expiresIn: "15m" });
    expect(verifyAccessToken(bareToken)).toBeNull();
  });

  it("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign({ sub: "emp-1", role: "SUPER_ADMIN", type: "access" }, "wrong-secret", { expiresIn: "15m" });
    expect(verifyAccessToken(forged)).toBeNull();
  });
});
