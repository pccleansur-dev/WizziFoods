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
    expect(markup).toContain('href="/Politicas-de-Privacidad"');
    expect(markup).toContain("Política de privacidad");
    expect(markup).toContain('href="/Condiciones-de-Servicio"');
    expect(markup).toContain("Condiciones del servicio");
    expect(markup).not.toContain("Crear cuenta");
  });
});
