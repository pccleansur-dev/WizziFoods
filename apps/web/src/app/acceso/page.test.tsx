import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AccessPage from "./page";

async function render(params: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await AccessPage({ searchParams: Promise.resolve(params) })
  );
}

describe("AccessPage", () => {
  it("offers administrative access without public registration", async () => {
    const markup = await render();

    expect(markup).toContain("Wizzi Foods");
    expect(markup).toContain("Ingresá a tu negocio");
    expect(markup).toContain("Continuar con Google");
    expect(markup).toContain("Correo electrónico");
    expect(markup).toContain("¿Olvidaste tu contraseña?");
    expect(markup).toContain('href="/Politicas-de-Privacidad"');
    expect(markup).toContain("Política de privacidad");
    expect(markup).toContain('href="/Condiciones-de-Servicio"');
    expect(markup).toContain("Condiciones del servicio");
    expect(markup).not.toContain("Crear cuenta");
    expect(markup).not.toContain("form-message");
  });

  it("explains an expired or unusable link instead of failing silently", async () => {
    const expired = await render({ error: "enlace-vencido" });
    const unknown = await render({ error: "no-se-pudo-validar" });

    expect(expired).toContain("El enlace venció o ya fue utilizado");
    expect(expired).toContain('role="alert"');
    expect(unknown).toContain("No pudimos validar tu cuenta");
  });

  it("confirms a password change and ignores unknown error codes", async () => {
    const changed = await render({ "clave-actualizada": "1" });
    const ignored = await render({ error: "<script>x</script>" });

    expect(changed).toContain("Contraseña actualizada");
    expect(changed).toContain("form-message--success");
    expect(ignored).not.toContain("form-message");
  });
});
