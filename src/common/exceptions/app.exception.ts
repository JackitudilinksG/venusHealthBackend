import { HttpException, HttpStatus } from '@nestjs/common';

interface AppExceptionOptions {
  code: string;
  message: string;
  statusCode: HttpStatus;
  context?: Record<string, unknown>;
  isOperational?: boolean;
}

export class AppException extends HttpException {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor({ code, message, statusCode, context, isOperational = true }: AppExceptionOptions) {
    super({ code, message }, statusCode);
    this.code = code;
    if (context !== undefined) {
      this.context = context;
    }
    this.isOperational = isOperational;
  }
}
