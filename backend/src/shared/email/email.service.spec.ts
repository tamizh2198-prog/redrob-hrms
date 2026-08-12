import { EmailService } from './email.service';

describe('EmailService (Auth Phase 2)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports sent=false and does not throw when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const service = new EmailService();
    const result = await service.send({
      to: 'jane@co.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result).toEqual({ sent: false });
  });
});
