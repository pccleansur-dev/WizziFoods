import { type ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { type AbstractHttpAdapter, BaseExceptionFilter } from "@nestjs/core";
import type { PlatformLogger } from "@platform/observability";
import type { FastifyRequest } from "fastify";

/**
 * Registra los errores que la API no esperaba (todo lo que no es una `HttpException`) antes de
 * contestar el 500 genérico de siempre. Sin esto una falla de base o de código interno responde
 * "Internal server error" y no deja ninguna pista en los registros.
 */
@Catch()
export class UnhandledErrorFilter extends BaseExceptionFilter {
  constructor(
    private readonly logger: PlatformLogger,
    httpAdapter: AbstractHttpAdapter
  ) {
    super(httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      const request = host.switchToHttp().getRequest<FastifyRequest>();
      const error = exception instanceof Error ? exception : undefined;
      this.logger.error("unhandled_request_error", {
        errorName: error?.name ?? typeof exception,
        message: error?.message ?? "unknown error",
        method: request.method,
        requestId: request.id,
        route: request.routeOptions?.url ?? "unmatched",
        stack: error?.stack?.split("\n").slice(0, 8).join("\n")
      });
    }
    super.catch(exception, host);
  }
}
