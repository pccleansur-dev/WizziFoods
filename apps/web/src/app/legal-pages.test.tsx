import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TermsPage, {
  metadata as termsMetadata
} from "./Condiciones-de-Servicio/page";
import PrivacyPage, {
  metadata as privacyMetadata
} from "./Politicas-de-Privacidad/page";

describe("public legal pages", () => {
  it("publishes the privacy policy with contact and service details", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);

    expect(privacyMetadata.title).toBe("Política de Privacidad | WizziFoods");
    expect(markup).toContain("Política de Privacidad");
    expect(markup).toContain("28 de octubre de 2026");
    expect(markup).toContain("dev@wizzi.com.ar");
    expect(markup).toContain("Google");
    expect(markup).toContain('href="/Condiciones-de-Servicio"');
  });

  it("publishes the service terms with contact and privacy navigation", () => {
    const markup = renderToStaticMarkup(<TermsPage />);

    expect(termsMetadata.title).toBe("Condiciones del Servicio | WizziFoods");
    expect(markup).toContain("Condiciones del Servicio");
    expect(markup).toContain("28 de octubre de 2026");
    expect(markup).toContain("dev@wizzi.com.ar");
    expect(markup).toContain("cuenta");
    expect(markup).toContain('href="/Politicas-de-Privacidad"');
  });
});
