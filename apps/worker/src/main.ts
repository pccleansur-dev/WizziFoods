import { pathToFileURL } from "node:url";

import { createServiceStatus, type ServiceStatus } from "@platform/contracts";

export function getWorkerStatus(): ServiceStatus {
  return createServiceStatus("worker");
}

function startWorker(): void {
  console.info(JSON.stringify(getWorkerStatus()));
  setInterval(() => undefined, 60_000);
}

const entryPoint = process.argv[1];

if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  startWorker();
}
