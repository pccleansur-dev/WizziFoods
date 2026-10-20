import { Controller, Get } from "@nestjs/common";
import { createServiceStatus, type ServiceStatus } from "@platform/contracts";

@Controller()
export class AppController {
  @Get("health")
  getHealth(): ServiceStatus {
    return createServiceStatus("api");
  }
}
