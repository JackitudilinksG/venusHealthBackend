import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const start = Date.now();
    const label = `${request.method} ${request.url}`;

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          if (ms > 1000) {
            this.logger.warn({ ms, url: request.url }, 'Slow request');
          } else {
            this.logger.log(`${label} — ${ms}ms`);
          }
        },
        error: (err: unknown) => {
          this.logger.error({ err, ms: Date.now() - start }, `${label} failed`);
        },
      }),
    );
  }
}
