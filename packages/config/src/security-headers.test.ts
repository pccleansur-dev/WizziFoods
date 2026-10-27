import { describe, expect, it } from "vitest";

import {
  apiSecurityHeaders,
  contentSecurityPolicy,
  webSecurityHeaders
} from "./security-headers.js";

const sources = {
  apiUrl: "https://api.example.com",
  supabaseUrl: "https://supabase.example.com"
};

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/u))
    .find(([first]) => first === name);
  return found ? found.slice(1) : [];
}

describe("content security policy", () => {
  const policy = contentSecurityPolicy({ ...sources, development: false });

  it("allows only the platform itself, its API and its Supabase", () => {
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://api.example.com",
      "https://supabase.example.com",
      "wss://supabase.example.com"
    ]);
    expect(directive(policy, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://supabase.example.com",
      "https://api.example.com"
    ]);
  });

  it("forbids being framed, plugins, a different base and forms to anywhere else", () => {
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual([
      "'self'",
      "https://api.example.com"
    ]);
  });

  it("never allows eval in production and only the development server gets it", () => {
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
    expect(
      directive(
        contentSecurityPolicy({ ...sources, development: true }),
        "script-src"
      )
    ).toContain("'unsafe-eval'");
  });

  it("opens a websocket to the same Supabase, plain ws for a plain http one", () => {
    const local = {
      apiUrl: "http://localhost:3001",
      supabaseUrl: "http://localhost:18000"
    };
    expect(
      directive(
        contentSecurityPolicy({ ...local, development: true }),
        "connect-src"
      )
    ).toContain("ws://localhost:18000");
  });

  it("ignores a source that is not an http(s) address", () => {
    const odd = contentSecurityPolicy({
      apiUrl: "javascript:alert(1)",
      development: false,
      supabaseUrl: "https://supabase.example.com; script-src *"
    });
    expect(odd).not.toContain("javascript:");
    expect(odd).not.toContain("script-src *");
  });
});

describe("headers", () => {
  it("the web sets the hardening headers, HSTS only in production", () => {
    const production = Object.fromEntries(
      webSecurityHeaders({ ...sources, development: false }).map((header) => [
        header.key,
        header.value
      ])
    );
    expect(production["X-Content-Type-Options"]).toBe("nosniff");
    expect(production["X-Frame-Options"]).toBe("DENY");
    expect(production["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(production["Permissions-Policy"]).toContain("camera=()");
    expect(production["Strict-Transport-Security"]).toContain("max-age=");
    expect(production["Content-Security-Policy"]).toContain("default-src");
    const development = webSecurityHeaders({ ...sources, development: true });
    expect(
      development.some(({ key }) => key === "Strict-Transport-Security")
    ).toBe(false);
  });

  it("the API answers with nothing cacheable and nothing sniffable", () => {
    const headers = apiSecurityHeaders({ production: true });
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["strict-transport-security"]).toBeDefined();
    expect(
      apiSecurityHeaders({ production: false })["strict-transport-security"]
    ).toBeUndefined();
  });
});
