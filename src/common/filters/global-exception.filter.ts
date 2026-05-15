import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ENV } from '../../config/env.constants';
import { AppException } from '../exceptions/app.exception';

type RequestWithId = Request & {
  id?: string;
};

interface ValidationErrorBody {
  message: string[];
}

interface HttpErrorBody {
  message?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithId>();
    const response = ctx.getResponse<Response>();
    const requestId = request.id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null && 'message' in body) {
        const validationBody = body as ValidationErrorBody;
        if (Array.isArray(validationBody.message)) {
          response.status(status).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              requestId,
              fields: validationBody.message,
            },
          });
          return;
        }
      }

      const isOperational = exception instanceof AppException ? exception.isOperational : true;
      if (!isOperational) {
        this.logger.error({ exception, requestId }, 'Non-operational AppException');
      }

      const errorBody = typeof body === 'string' ? body : (body as HttpErrorBody).message;
      response.status(status).json({
        error: {
          code: exception instanceof AppException ? exception.code : 'HTTP_ERROR',
          message: errorBody,
          requestId,
          ...(process.env[ENV.NODE_ENV] !== 'production' &&
            exception instanceof AppException && { context: exception.context }),
        },
      });
      return;
    }

    this.logger.error({ exception, requestId }, 'Unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId,
      },
    });
  }
}
