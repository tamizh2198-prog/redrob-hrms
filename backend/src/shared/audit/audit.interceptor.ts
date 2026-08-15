import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { AuditService } from '../../modules/audit/audit.service';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Never persist credentials/secrets into a table HR Admins can browse —
// login/refresh bodies carry a password, and auth responses carry tokens.
const SENSITIVE_FIELD_PATTERN =
  /password|token|secret|pan|aadhaar|bankaccount/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELD_PATTERN.test(key) ? '[REDACTED]' : redact(val);
  }
  return out;
}

// Section 10 Cross-Cutting Design: "Audit Logging middleware ... wraps every
// state-changing endpoint automatically." Strips the global "api/v1" prefix
// (set in main.ts) so `module` is just the feature's own path segment, e.g.
// "helpdesk" rather than "api".
function deriveModule(path: string): string {
  const segments = path.split('?')[0].split('/').filter(Boolean);
  const withoutPrefix =
    segments[0] === 'api' && segments[1] === 'v1'
      ? segments.slice(2)
      : segments;
  return withoutPrefix[0] ?? 'unknown';
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { method, originalUrl, user, body } = request;

    if (!STATE_CHANGING_METHODS.has(method)) {
      return next.handle();
    }

    const base = {
      actorId: user?.userId,
      actorRole: user?.role,
      method,
      path: originalUrl,
      module: deriveModule(originalUrl),
      requestBody: redact(body),
    };

    return next.handle().pipe(
      tap((responseBody) => {
        this.logger.log(
          `${method} ${originalUrl} by ${user?.userId ?? 'anonymous'}`,
        );
        const response = context.switchToHttp().getResponse<Response>();
        // A StreamableFile wraps a raw Buffer, which is itself a plain
        // object of numeric byte-index keys — redact() would recurse into
        // every single byte as an "entry", producing a response body of
        // (sometimes millions of) keys. That blew past Railway's log-rate
        // limit, made this synchronous audit write pathologically slow,
        // and stored the entire exported file's bytes in the audit log —
        // which is how every POST /analytics/reports/build export (CSV,
        // Excel, and PDF alike, since all three return a StreamableFile)
        // ended up failing instead of downloading.
        void this.auditService.record({
          ...base,
          statusCode: response.statusCode,
          responseBody:
            responseBody instanceof StreamableFile
              ? { note: '[file download — body not logged]' }
              : redact(responseBody),
        });
      }),
      catchError((error: { status?: number; message?: string }) => {
        this.logger.log(
          `${method} ${originalUrl} by ${user?.userId ?? 'anonymous'} failed`,
        );
        void this.auditService.record({
          ...base,
          statusCode: error?.status ?? 500,
          responseBody: { error: error?.message ?? 'Unknown error' },
        });
        return throwError(() => error);
      }),
    );
  }
}
