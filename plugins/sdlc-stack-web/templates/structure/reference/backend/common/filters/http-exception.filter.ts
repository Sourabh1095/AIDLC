import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages";

// Maps EVERY error to the single api-design error shape. Expected failures
// (HttpException thrown by services) keep their status + message; anything unknown
// becomes a safe 500 with no stack leaked to the client (full detail to the logger).
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload: unknown = isHttp ? exception.getResponse() : undefined;

    const rawMessage =
      typeof payload === "string"
        ? payload
        : ((payload as { message?: string | string[] } | undefined)?.message ??
          MESSAGES.common.internal);
    const details =
      payload && typeof payload === "object" && "details" in payload
        ? (payload as { details?: unknown }).details
        : undefined;

    if (!isHttp || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message: Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage,
      ...(details ? { details } : {}),
      requestId: (req.headers["x-request-id"] as string | undefined) ?? null,
    });
  }
}
