import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";
import { readWebConfig } from "@platform/config";

const localEnvironmentPath = resolve(import.meta.dirname, "../../.env");
if (existsSync(localEnvironmentPath)) {
  process.loadEnvFile(localEnvironmentPath);
}

const runtimeConfig = readWebConfig(process.env);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: runtimeConfig.apiUrl
  },
  experimental: {
    cpus: 1,
    serverActions: {
      bodySizeLimit: "9mb"
    }
  },
  transpilePackages: [
    "@platform/config",
    "@platform/contracts",
    "@platform/observability"
  ]
};

export default nextConfig;
