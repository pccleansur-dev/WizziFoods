import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException
} from "@nestjs/common";

export const DATABASE_PING = Symbol("DATABASE_PING");

export type DatabasePing = { ping(): Promise<void> };

/**
 * `/health` says the process is alive; `/ready` says it can do its job, which needs the
 * database. The deployment (Coolify) points its health check here, so a release that cannot
 * reach the database never takes traffic and the previous one keeps serving. Nothing about
 * the failure leaves the process: no host, no message, no credentials.
 */
@Controller()
export class ReadinessController {
  /** How long the database gets to answer before the release counts as not ready. */
  timeoutMs = 3_000;

  constructor(@Inject(DATABASE_PING) private readonly database: DatabasePing) {}

  @Get("ready")
  async getReady() {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.database.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("timeout")),
            this.timeoutMs
          );
        })
      ]).finally(() => clearTimeout(timer));
    } catch {
      throw new ServiceUnavailableException({
        checks: { database: "unavailable" },
        service: "api",
        status: "not_ready"
      });
    }
    return {
      checks: { database: "ok" },
      service: "api",
      status: "ready"
    };
  }
}
