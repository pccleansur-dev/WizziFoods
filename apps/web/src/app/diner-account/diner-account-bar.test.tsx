import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GuestPrompt } from "./diner-account-bar";
import { backPath } from "./diner-client";

describe("GuestPrompt", () => {
  it("always offers to continue without an account next to the optional login", () => {
    const markup = renderToStaticMarkup(
      <GuestPrompt dismissed={false} nextPath="/m/abc" onDismiss={vi.fn()} />
    );
    expect(markup).toContain("Continuar sin cuenta");
    expect(markup).toContain("Ingresar con Google");
    expect(markup).toContain("opcional");
    expect(markup).toContain('action="/api/diner/login"');
    expect(markup).toContain('value="/m/abc"');
  });

  it("keeps a quiet way back to the login after the diner declined", () => {
    const markup = renderToStaticMarkup(
      <GuestPrompt dismissed nextPath="/m/abc" onDismiss={vi.fn()} />
    );
    expect(markup).not.toContain("Continuar sin cuenta");
    expect(markup).toContain("Ingresar con Google (opcional)");
  });

  it("never asks for an email or a password", () => {
    const markup = renderToStaticMarkup(
      <GuestPrompt dismissed={false} nextPath="/" onDismiss={vi.fn()} />
    );
    expect(markup).not.toMatch(/type="(email|password)"/u);
  });
});

describe("backPath", () => {
  it("keeps local paths and drops anything that could leave the host", () => {
    expect(backPath("/m/abc")).toBe("/m/abc");
    for (const bad of ["//evil.test", "https://evil.test", "/\\x", "", null]) {
      expect(backPath(bad)).toBe("/");
    }
  });
});
