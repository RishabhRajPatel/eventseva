import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';

/** Error with a stable machine-readable code; the app shows `message` (or its own text for `code`). */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}

/** Every error leaves the API as `{ "error": { "code", "message", ...details } }`. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      res.status(exception.getStatus()).json({
        error: { code: exception.code, message: exception.message, ...exception.details },
      });
      return;
    }
    if (exception instanceof ThrottlerException) {
      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' },
      });
      return;
    }
    if (exception instanceof BadRequestException) {
      const body = exception.getResponse() as { message?: string | string[] };
      const message = Array.isArray(body.message) ? body.message.join('; ') : body.message || 'Invalid request';
      res.status(HttpStatus.BAD_REQUEST).json({ error: { code: 'VALIDATION', message } });
      return;
    }
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        error: { code: HttpStatus[exception.getStatus()] ?? 'ERROR', message: exception.message },
      });
      return;
    }

    // Stack traces stay in the logs; the user only gets a simple message.
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    });
  }
}
