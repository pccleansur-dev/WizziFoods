import { pathToFileURL } from "node:url";

import { readWorkerConfig } from "@platform/config";
import { createServiceStatus, type ServiceStatus } from "@platform/contracts";

export function getWorkerStatus(): ServiceStatus {
  return createServiceStatus("worker");
}

function startWorker(): void {
  const config = readWorkerConfig(process.env);
  console.info(JSON.stringify(getWorkerStatus()));
  setInterval(() => undefined, config.heartbeatMs);
}

const entryPoint = process.argv[1];

if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  startWorker();
}
