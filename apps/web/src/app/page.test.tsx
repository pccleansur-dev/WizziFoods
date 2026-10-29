import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((path: string): never => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { default: HomePage } = await import("./page");

describe("HomePage", () => {
  it("sends the bare domain to the access screen", async () => {
    await expect(
      HomePage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("REDIRECT:/acceso");
  });

  it("keeps a failed sign-in visible instead of dropping the error", async () => {
    await expect(
      HomePage({
        searchParams: Promise.resolve({ error: "invalid_request" })
      })
    ).rejects.toThrow("REDIRECT:/acceso?error=no-se-pudo-validar");
  });
});
