import { encryptPii, decryptPii, isEncryptedPiiValue, encryptPiiNullable, decryptPiiNullable } from "./pii-crypto";

describe("pii-crypto (HRMS-11): field-level encryption at rest", () => {
  it("round-trips a plaintext value", () => {
    expect(decryptPii(encryptPii("ABCDE1234F"))).toBe("ABCDE1234F");
  });

  it("produces different ciphertext for the same plaintext each time (random IV), but both decrypt correctly", () => {
    const a = encryptPii("999911112222");
    const b = encryptPii("999911112222");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe("999911112222");
    expect(decryptPii(b)).toBe("999911112222");
  });

  it("is tagged with the v1 version prefix", () => {
    expect(isEncryptedPiiValue(encryptPii("ABCDE1234F"))).toBe(true);
    expect(isEncryptedPiiValue("ABCDE1234F")).toBe(false);
    expect(isEncryptedPiiValue(null)).toBe(false);
    expect(isEncryptedPiiValue(undefined)).toBe(false);
  });

  it("returns a non-prefixed (legacy plaintext) value unchanged on decrypt", () => {
    expect(decryptPii("ABCDE1234F")).toBe("ABCDE1234F");
  });

  it("rejects tampered ciphertext (GCM auth failure)", () => {
    const encrypted = encryptPii("ABCDE1234F");
    const parts = encrypted.split(":");
    // Flip a bit in the decoded ciphertext bytes (rather than the base64
    // text itself, whose last character can be padding-insensitive).
    const buf = Buffer.from(parts[3], "base64");
    buf[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], buf.toString("base64")].join(":");
    expect(() => decryptPii(tampered)).toThrow();
  });

  it("rejects decryption with the wrong key", () => {
    const original = process.env.PII_ENCRYPTION_KEY;
    const encrypted = encryptPii("ABCDE1234F");
    process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    jest.resetModules();
    // Re-require with the new env var and a fresh module-level key cache.
    const { decryptPii: decryptWithWrongKey } = jest.requireActual("./pii-crypto") as typeof import("./pii-crypto");
    expect(() => decryptWithWrongKey(encrypted)).toThrow();
    process.env.PII_ENCRYPTION_KEY = original;
  });

  it("throws when PII_ENCRYPTION_KEY is unset", () => {
    const original = process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_ENCRYPTION_KEY;
    jest.resetModules();
    const { encryptPii: encryptWithoutKey } = jest.requireActual("./pii-crypto") as typeof import("./pii-crypto");
    expect(() => encryptWithoutKey("ABCDE1234F")).toThrow("PII_ENCRYPTION_KEY must be set");
    process.env.PII_ENCRYPTION_KEY = original;
  });

  it("throws when PII_ENCRYPTION_KEY isn't exactly 32 bytes", () => {
    const original = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    jest.resetModules();
    const { encryptPii: encryptWithShortKey } = jest.requireActual("./pii-crypto") as typeof import("./pii-crypto");
    expect(() => encryptWithShortKey("ABCDE1234F")).toThrow(/must decode/);
    process.env.PII_ENCRYPTION_KEY = original;
  });

  it("nullable helpers pass through null/undefined/empty string without encrypting", () => {
    expect(encryptPiiNullable(null)).toBeNull();
    expect(encryptPiiNullable(undefined)).toBeUndefined();
    expect(encryptPiiNullable("")).toBe("");
    expect(decryptPiiNullable(null)).toBeNull();
    expect(decryptPiiNullable(undefined)).toBeUndefined();
    expect(decryptPiiNullable("")).toBe("");
  });

  it("nullable helpers encrypt/decrypt real values", () => {
    const encrypted = encryptPiiNullable("ABCDE1234F");
    expect(typeof encrypted).toBe("string");
    expect(isEncryptedPiiValue(encrypted as string)).toBe(true);
    expect(decryptPiiNullable(encrypted)).toBe("ABCDE1234F");
  });
});
