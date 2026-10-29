import type { PublicBrandView } from "@platform/contracts";
import type { CSSProperties } from "react";

import { brandIconUrl } from "../../../lib/brand";
import { readableTextColor } from "../../panel/color-contrast";

/** Colores del negocio como variables CSS; la página sigue siendo legible sin ellos. */
export function dinerBrandStyle(brand: PublicBrandView | null): CSSProperties {
  if (!brand) return {};
  return {
    "--brand-bg": brand.backgroundColor,
    "--brand-primary": brand.primaryColor,
    "--brand-primary-text": readableTextColor(brand.primaryColor)
  } as CSSProperties;
}

export function DinerBrandHeader({ brand }: { brand: PublicBrandView | null }) {
  if (!brand) return null;
  return (
    <header className="diner-brand">
      {brand.logoVersion ? (
        // eslint-disable-next-line @next/next/no-img-element -- ícono generado por la API
        <img
          alt=""
          className="diner-brand__logo"
          height={48}
          src={brandIconUrl(192, { version: brand.logoVersion })}
          width={48}
        />
      ) : null}
      <span className="diner-brand__name">{brand.name}</span>
    </header>
  );
}
