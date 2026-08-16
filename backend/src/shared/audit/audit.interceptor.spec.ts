import { StreamableFile, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../../modules/audit/audit.service';

function createContext(overrides: {
  method?: string;
  originalUrl?: string;
  user?: { userId: string; role: string };
  body?: unknown;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? 'POST',
    originalUrl: overrides.originalUrl ?? '/api/v1/analytics/reports/build',
    user: overrides.user ?? { userId: 'hr-1', role: 'HR_ADMIN' },
    body: overrides.body ?? {},
  };
  const response = { statusCode: 200 };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('AuditInterceptor', () => {
  let auditService: { record: jest.Mock };
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    interceptor = new AuditInterceptor(auditService as unknown as AuditService);
  });

  it("this task: never walks a StreamableFile's raw Buffer byte-by-byte into the audit log", async () => {
    // A large buffer is exactly the shape that broke: redact() would treat
    // it as a plain object and recurse into every numeric byte index.
    const file = new StreamableFile(Buffer.from('x'.repeat(50_000)), {
      type: 'text/csv',
    });

    await new Promise<void>((resolve) => {
      interceptor
        .intercept(createContext({}), handlerReturning(file))
        .subscribe({ complete: resolve });
    });

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const entry = auditService.record.mock.calls[0][0];
    expect(entry.responseBody).toEqual({
      note: '[file download — body not logged]',
    });
    // Confirms the fix, not just the symptom: the recorded entry must not
    // contain a huge byte-indexed object anywhere near the buffer's size.
    expect(JSON.stringify(entry).length).toBeLessThan(1000);
  });

  it('still redacts and records a normal JSON response body as before', async () => {
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(
          createContext({}),
          handlerReturning({ total: 2, rows: [{ id: 'r-1' }] }),
        )
        .subscribe({ complete: resolve });
    });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        responseBody: { total: 2, rows: [{ id: 'r-1' }] },
      }),
    );
  });

  it('redacts sensitive fields in a normal (non-file) response body', async () => {
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(
          createContext({}),
          handlerReturning({ accessToken: 'secret-token', name: 'Ada' }),
        )
        .subscribe({ complete: resolve });
    });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        responseBody: { accessToken: '[REDACTED]', name: 'Ada' },
      }),
    );
  });

  it('skips auditing entirely for non-state-changing methods (GET)', async () => {
    let completed = false;
    await new Promise<void>((resolve) => {
      interceptor
        .intercept(
          createContext({ method: 'GET' }),
          handlerReturning({ ok: true }),
        )
        .subscribe({
          complete: () => {
            completed = true;
            resolve();
          },
        });
    });

    expect(completed).toBe(true);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
