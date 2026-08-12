import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';

describe('MfaService', () => {
  const service = new MfaService();

  it('generates a secret and verifies a valid code for it', () => {
    const secret = service.generateSecret();
    const code = authenticator.generate(secret);
    expect(service.verify(code, secret)).toBe(true);
  });

  it('rejects a code generated for a different secret', () => {
    const secretA = service.generateSecret();
    const secretB = service.generateSecret();
    const codeForB = authenticator.generate(secretB);
    expect(service.verify(codeForB, secretA)).toBe(false);
  });

  it('rejects a garbage code without throwing', () => {
    const secret = service.generateSecret();
    expect(service.verify('not-a-code', secret)).toBe(false);
  });

  it('builds an enrollment payload with a scannable QR data URL', async () => {
    const secret = service.generateSecret();
    const enrollment = await service.buildEnrollment('emp@example.com', secret);
    expect(enrollment.secret).toBe(secret);
    expect(enrollment.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
