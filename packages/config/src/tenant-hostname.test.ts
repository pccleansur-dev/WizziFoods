import { describe, expect, it } from "vitest";

import {
  defaultTenantHostTemplate,
  tenantHostname,
  validateTenantHostTemplate
} from "./tenant-hostname.js";

describe("tenant hostname", () => {
  it("keeps <slug>.<domain> unless told otherwise", () => {
    expect(defaultTenantHostTemplate).toBe("{slug}.{domain}");
    expect(
      tenantHostname(defaultTenantHostTemplate, "donjuan", "plataforma.test")
    ).toBe("donjuan.plataforma.test");
  });

  it("builds a single-level name, so one wildcard certificate covers every business", () => {
    expect(
      tenantHostname("{slug}-carta.{domain}", "donjuan", "wizzi.com.ar")
    ).toBe("donjuan-carta.wizzi.com.ar");
  });

  it("accepts only templates with the slug once and the domain once", () => {
    expect(() =>
      validateTenantHostTemplate("{slug}-carta.{domain}")
    ).not.toThrow();
    expect(() => validateTenantHostTemplate("carta.{domain}")).toThrow(
      /\{slug\}/u
    );
    expect(() => validateTenantHostTemplate("{slug}.{slug}.{domain}")).toThrow(
      /\{slug\}/u
    );
    expect(() => validateTenantHostTemplate("{slug}.carta.com")).toThrow(
      /\{domain\}/u
    );
  });

  it("rejects templates that could produce something that is not a hostname", () => {
    for (const bad of [
      "{slug}_carta.{domain}",
      "{slug}/carta.{domain}",
      "{slug}.{domain}/x",
      "{SLUG}.{domain}",
      "https://{slug}.{domain}",
      "{slug} .{domain}"
    ]) {
      expect(() => validateTenantHostTemplate(bad)).toThrow();
    }
  });

  it("refuses a slug or domain that would not make a valid name", () => {
    expect(() =>
      tenantHostname("{slug}.{domain}", "Don Juan", "wizzi.com.ar")
    ).toThrow();
    expect(() =>
      tenantHostname("{slug}-carta.{domain}", "a".repeat(60), "wizzi.com.ar")
    ).toThrow(/63/u);
  });
});
