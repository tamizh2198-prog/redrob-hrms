import * as dns from 'dns';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');
jest.mock('dns', () => ({
  promises: { resolve4: jest.fn() },
}));

describe('EmailService (Auth Phase 2)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
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

  describe('This task: prefer IPv4 for Gmail SMTP to avoid unreachable IPv6 routes', () => {
    beforeEach(() => {
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'user@gmail.com';
      process.env.SMTP_PASS = 'app-password';
    });

    it('connects using the resolved IPv4 address while keeping the original host as the TLS servername', async () => {
      (dns.promises.resolve4 as jest.Mock).mockResolvedValue(['142.250.31.109']);
      const sendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

      const service = new EmailService();
      const result = await service.send({ to: 'jane@co.com', subject: 'Test', text: 'Hello' });

      expect(result).toEqual({ sent: true });
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '142.250.31.109',
          servername: 'smtp.gmail.com',
        }),
      );
    });

    it('falls back to hostname-based resolution if the IPv4 lookup fails', async () => {
      (dns.promises.resolve4 as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));
      const sendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

      const service = new EmailService();
      const result = await service.send({ to: 'jane@co.com', subject: 'Test', text: 'Hello' });

      expect(result).toEqual({ sent: true });
      const callArg = (nodemailer.createTransport as jest.Mock).mock.calls[0][0];
      expect(callArg.host).toBe('smtp.gmail.com');
      expect(callArg.servername).toBeUndefined();
    });

    it('bounds connect/greeting/socket timeouts so an unreachable host fails fast instead of hanging the request', async () => {
      (dns.promises.resolve4 as jest.Mock).mockResolvedValue(['142.250.31.109']);
      const sendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

      const service = new EmailService();
      await service.send({ to: 'jane@co.com', subject: 'Test', text: 'Hello' });

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: expect.any(Number),
          greetingTimeout: expect.any(Number),
          socketTimeout: expect.any(Number),
        }),
      );
    });
  });
});
