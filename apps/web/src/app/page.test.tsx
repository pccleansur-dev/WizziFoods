import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("explains that the technical foundation is ready", () => {
    const markup = renderToStaticMarkup(<HomePage />);

    expect(markup).toContain("Wizzi Foods");
    expect(markup).toContain("Base técnica lista");
  });
});
