import { describe, expect, it, vi } from "vitest";
import StaffAccessPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(path);
  }
}));

describe("StaffAccessPage", () => {
  it("moves existing employee links to the shared access with the same business", async () => {
    await expect(
      StaffAccessPage({
        params: Promise.resolve({ tenantSlug: "restaurante-demo" }),
        searchParams: Promise.resolve({ estado: "no-disponible" })
      })
    ).rejects.toThrow(
      "/acceso?tipo=equipo&local=restaurante-demo&estado=no-disponible"
    );
  });
});
