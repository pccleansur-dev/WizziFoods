import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StaffAccessPage from "./page";

describe("StaffAccessPage", () => {
  it("shows the mobile internal access with individual credentials", async () => {
    const page = await StaffAccessPage({
      params: Promise.resolve({ tenantSlug: "restaurante-demo" })
    });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Comenzá tu turno");
    expect(markup).toContain("Usuario");
    expect(markup).toContain("PIN de 6 dígitos");
    expect(markup).not.toContain("Google");
  });
});
