import { EmailService } from './email.service';

describe('EmailService (Auth Phase 2)', () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  it('reports sent=false and does not throw when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    const service = new EmailService();
    const result = await service.send({
      to: 'jane@co.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result).toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('This task: send via Resend HTTPS API instead of SMTP, since Railway blocks outbound SMTP below its Pro plan', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 're_test_key';
      process.env.EMAIL_FROM = 'hrms@mckinleyrice.co';
    });

    it('posts to the Resend API with the API key and from address, and reports sent=true on success', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      const service = new EmailService();
      const result = await service.send({
        to: 'jane@co.com',
        subject: 'Test',
        text: 'Hello',
      });

      expect(result).toEqual({ sent: true });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test_key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            from: 'hrms@mckinleyrice.co',
            to: 'jane@co.com',
            subject: 'Test',
            text: 'Hello',
          }),
        }),
      );
    });

    it('reports sent=false and never throws when the Resend API returns a non-2xx response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('{"message":"invalid from address"}'),
      });

      const service = new EmailService();
      const result = await service.send({
        to: 'jane@co.com',
        subject: 'Test',
        text: 'Hello',
      });

      expect(result).toEqual({ sent: false });
    });

    it('reports sent=false and never throws when the request itself fails (network error/timeout)', async () => {
      fetchMock.mockRejectedValue(new Error('The operation was aborted'));

      const service = new EmailService();
      await expect(
        service.send({ to: 'jane@co.com', subject: 'Test', text: 'Hello' }),
      ).resolves.toEqual({ sent: false });
    });

    it('bounds the request with a timeout so an unreachable API fails fast instead of hanging the caller', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      const service = new EmailService();
      await service.send({ to: 'jane@co.com', subject: 'Test', text: 'Hello' });

      const options = fetchMock.mock.calls[0][1];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
