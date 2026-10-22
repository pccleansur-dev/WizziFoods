import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PanelContent } from "./panel-content";

const identity = {
  assuranceLevel: "aal2" as const,
  userId: "10000000-0000-4000-8000-000000000001"
};

describe("PanelContent", () => {
  it("keeps the superadmin in platform administration", () => {
    const markup = renderToStaticMarkup(
      <PanelContent
        administrativeAccess={{
          access: { type: "platform_superadmin" },
          identity
        }}
      />
    );

    expect(markup).toContain("Crear y entregar negocios");
    expect(markup).toContain("Nombre del negocio");
    expect(markup).toContain("Correo del administrador");
    expect(markup).not.toContain("Gestionar carta");
  });

  it("shows only the assigned business to its administrator", () => {
    const markup = renderToStaticMarkup(
      <PanelContent
        administrativeAccess={{
          access: {
            tenantContexts: [
              {
                location: { id: "location-1", name: "Principal" },
                role: "admin",
                tenant: {
                  id: "tenant-1",
                  name: "Bodegón del Centro",
                  slug: "bodegon-del-centro",
                  status: "draft"
                }
              }
            ],
            type: "tenant_admin"
          },
          identity
        }}
      />
    );

    expect(markup).toContain("Bodegón del Centro");
    expect(markup).toContain("Gestionar carta");
    expect(markup).not.toContain("Crear y entregar negocios");
  });
});
