import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthenticatedRequest } from '../auth/authenticated-request.interface';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { method, originalUrl, user } = request;

    if (!STATE_CHANGING_METHODS.has(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        // TODO: persist to the audit_log table once the Audit module's data
        // model (Section 7.18) lands; logging is the Step 0 placeholder.
        this.logger.log(
          `${method} ${originalUrl} by ${user?.userId ?? 'anonymous'}`,
        );
      }),
    );
  }
}
