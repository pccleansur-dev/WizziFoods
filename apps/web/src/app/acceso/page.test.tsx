import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AccessPage from "./page";

describe("AccessPage", () => {
  it("offers administrative access without public registration", () => {
    const markup = renderToStaticMarkup(<AccessPage />);

    expect(markup).toContain("Ingresá a tu negocio");
    expect(markup).toContain("Continuar con Google");
    expect(markup).toContain("Correo electrónico");
    expect(markup).toContain("¿Olvidaste tu contraseña?");
    expect(markup).not.toContain("Crear cuenta");
  });
});
