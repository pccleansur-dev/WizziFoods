import { describe, expect, it } from "vitest";

import { parseTenantHostname } from "./tenant-domain.js";

describe("parseTenantHostname", () => {
  it("canonicalizes a DNS hostname and removes its transport port", () => {
    expect(parseTenantHostname("  Local-A.Plataforma.Test:3001 ")).toBe(
      "local-a.plataforma.test"
    );
    expect(parseTenantHostname("local-a.plataforma.test.")).toBe(
      "local-a.plataforma.test"
    );
  });

  it("rejects missing, ambiguous and non-DNS authorities", () => {
    expect(parseTenantHostname(undefined)).toBeNull();
    expect(parseTenantHostname(["a.test", "b.test"])).toBeNull();
    expect(parseTenantHostname("a.test,b.test")).toBeNull();
    expect(parseTenantHostname("user@a.test")).toBeNull();
    expect(parseTenantHostname("a.test/path")).toBeNull();
    expect(parseTenantHostname("127.0.0.1")).toBeNull();
  });

  it("rejects invalid labels and transport ports", () => {
    expect(parseTenantHostname("-invalid.test")).toBeNull();
    expect(parseTenantHostname("invalid-.test")).toBeNull();
    expect(parseTenantHostname("valid.test:0")).toBeNull();
    expect(parseTenantHostname("valid.test:65536")).toBeNull();
  });
});
