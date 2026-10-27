import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { NextConfig } from "next";
import { readWebConfig, webSecurityHeaders } from "@platform/config";

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
  // The container image runs the traced standalone server (see the Dockerfile); everywhere
  // else (`next dev`, `next start`, the E2E) the normal output is kept.
  ...(process.env.NEXT_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: resolve(import.meta.dirname, "../..")
      }
    : {}),
  env: {
    NEXT_PUBLIC_API_URL: runtimeConfig.apiUrl
  },
  logging: {
    // The dev server prints Server Function arguments, which here include PINs
    // and provider credentials. Never log them.
    serverFunctions: false
  },
  async headers() {
    return [
      {
        headers: webSecurityHeaders({
          apiUrl: runtimeConfig.apiUrl,
          development: process.env.NODE_ENV !== "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
        }),
        source: "/:path*"
      }
    ];
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
