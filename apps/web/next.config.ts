import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";
import { readWebConfig } from "@platform/config";

const localEnvironmentPath = resolve(import.meta.dirname, "../../.env");
if (existsSync(localEnvironmentPath)) {
  process.loadEnvFile(localEnvironmentPath);
}

const runtimeConfig = readWebConfig(process.env);

// Hosts extra desde los que se abre el servidor de desarrollo (por ejemplo una
// tablet o un celular en la misma red). Sólo afecta a `next dev`.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  env: {
    NEXT_PUBLIC_API_URL: runtimeConfig.apiUrl
  },
  logging: {
    // The dev server prints Server Function arguments, which here include PINs
    // and provider credentials. Never log them.
    serverFunctions: false
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
