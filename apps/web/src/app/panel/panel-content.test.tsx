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
        platformOperations={{
          auditEvents: [
            {
              action: "tenant.suspension_requested",
              actorId: identity.userId,
              actorType: "platform_superadmin",
              correlationId: "suspension-001",
              id: "1",
              occurredAt: "2026-10-22T15:30:00.000Z",
              reason: "Subscription period ended",
              tenantId: "74000000-0000-4000-8000-000000000074",
              tenantName: "Café Norte"
            }
          ],
          tenants: [
            {
              id: "74000000-0000-4000-8000-000000000074",
              name: "Café Norte",
              primaryHostname: "cafe-norte.plataforma.test",
              slug: "cafe-norte",
              status: "active",
              suspension: null
            }
          ]
        }}
        catalog={null}
      />
    );

    expect(markup).toContain("Crear y entregar negocios");
    expect(markup).toContain("Nombre del negocio");
    expect(markup).toContain("Correo del administrador");
    expect(markup).toContain("Suspender un negocio");
    expect(markup).toContain("Comercial gradual");
    expect(markup).toContain("Seguridad inmediata");
    expect(markup).toContain("Actividad sensible reciente");
    expect(markup).toContain("Subscription period ended");
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
        businessProfile={{
          address: "San Martín 120",
          contactPhone: "+54 11 5555 5555",
          coverAssetId: null,
          description: "Cocina porteña",
          displayName: "Bodegón del Centro",
          languages: ["es", "en"],
          logoAssetId: null,
          openingHours: "Todos los días",
          referenceAssetIds: [],
          revision: 1,
          updatedAt: "2026-10-23T15:00:00.000Z",
          visual: {
            accentColor: "#D97706",
            headingStyle: "serif",
            layout: "visual",
            primaryColor: "#1F2937",
            secondaryColor: "#F9FAFB"
          }
        }}
        catalog={{
          basePublishedRevision: null,
          draft: {
            baseRevision: null,
            categories: [
              {
                content: [
                  { description: "", language: "es", title: "Principales" }
                ],
                id: "20000000-0000-4000-8000-000000000002",
                position: 0
              }
            ],
            products: [
              {
                categoryId: "20000000-0000-4000-8000-000000000002",
                content: [
                  {
                    description: "Con papas",
                    language: "es",
                    title: "Milanesa"
                  }
                ],
                id: "30000000-0000-4000-8000-000000000003",
                imageAssetId: null,
                position: 0,
                priceCents: 125000,
                sectorId: "40000000-0000-4000-8000-000000000004",
                variants: []
              }
            ],
            sectors: [
              {
                id: "40000000-0000-4000-8000-000000000004",
                kind: "kitchen",
                name: "Cocina",
                position: 0
              }
            ]
          },
          isDirty: true,
          revision: 1,
          updatedAt: "2026-10-23T15:00:00.000Z"
        }}
        publishedCatalog={{
          availability: {},
          catalog: {
            baseRevision: 1,
            categories: [
              {
                content: [
                  { description: "", language: "es", title: "Principales" }
                ],
                id: "20000000-0000-4000-8000-000000000002",
                position: 0
              }
            ],
            products: [
              {
                categoryId: "20000000-0000-4000-8000-000000000002",
                content: [
                  {
                    description: "Con papas",
                    language: "es",
                    title: "Milanesa"
                  }
                ],
                id: "30000000-0000-4000-8000-000000000003",
                imageAssetId: null,
                position: 0,
                priceCents: 125000,
                sectorId: "40000000-0000-4000-8000-000000000004",
                variants: []
              }
            ],
            sectors: [
              {
                id: "40000000-0000-4000-8000-000000000004",
                kind: "kitchen",
                name: "Cocina",
                position: 0
              }
            ]
          },
          publishedAt: "2026-10-23T16:00:00.000Z",
          revision: 1
        }}
      />
    );

    expect(markup).toContain("Bodegón del Centro");
    expect(markup).toContain("Datos e identidad");
    expect(markup).toContain("Logo del negocio");
    expect(markup).toContain("Imagen de portada");
    expect(markup).toContain("Fotos de referencia");
    expect(markup).toContain("Vista previa");
    expect(markup).toContain("no modifica lo publicado");
    expect(markup).toContain("Gestionar carta");
    expect(markup).toContain("Carta y productos");
    expect(markup).toContain("Vista previa de la carta");
    expect(markup).toContain("Agregar categoría");
    expect(markup).toContain("Contenido por idioma");
    expect(markup).toContain("Agregar variante");
    expect(markup).toContain("Disponibilidad inmediata");
    expect(markup).toContain("Milanesa");
    expect(markup).toContain("Disponible");
    expect(markup).not.toContain("Crear y entregar negocios");
  });
});
