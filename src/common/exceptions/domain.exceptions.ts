import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

export class NotFoundException extends AppException {
  constructor(resource: string, id?: string) {
    super({
      code: 'NOT_FOUND',
      message: `${resource}${id ? ` '${id}'` : ''} not found`,
      statusCode: HttpStatus.NOT_FOUND,
      context: { resource, id },
    });
  }
}

export class ValidationException extends AppException {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      code: 'VALIDATION_ERROR',
      message,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      ...(context !== undefined ? { context } : {}),
    });
  }
}

export class ConflictException extends AppException {
  constructor(resource: string, detail?: string) {
    super({
      code: 'CONFLICT',
      message: `${resource} already exists${detail ? `: ${detail}` : ''}`,
      statusCode: HttpStatus.CONFLICT,
    });
  }
}

export class BusinessException extends AppException {
  constructor(message: string, code = 'BUSINESS_RULE_VIOLATION') {
    super({ code, message, statusCode: HttpStatus.UNPROCESSABLE_ENTITY });
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Insufficient permissions') {
    super({ code: 'FORBIDDEN', message, statusCode: HttpStatus.FORBIDDEN });
  }
}

export class ExternalServiceException extends AppException {
  constructor(service: string, cause?: Error) {
    super({
      code: 'EXTERNAL_SERVICE_ERROR',
      message: `External service '${service}' failed`,
      statusCode: HttpStatus.BAD_GATEWAY,
      isOperational: false,
      context: { service },
    });
    if (cause) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack ?? cause.message}`;
    }
  }
}
