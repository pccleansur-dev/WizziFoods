export type ServiceName = "api" | "web" | "worker";

export interface ServiceStatus {
  service: ServiceName;
  status: "ok";
}

export function createServiceStatus(service: ServiceName): ServiceStatus {
  return { service, status: "ok" };
}
