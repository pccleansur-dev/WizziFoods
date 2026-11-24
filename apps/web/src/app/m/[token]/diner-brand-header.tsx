import type { PublicBrandView } from "@platform/contracts";
import type { CSSProperties } from "react";

import { brandIconUrl } from "../../../lib/brand";
import { readableTextColor } from "../../panel/color-contrast";

export function dinerBrandStyle(brand: PublicBrandView | null): CSSProperties {
  if (!brand) return {};
  const accent = brand.appearance?.accentColor ?? brand.primaryColor;
  return {
    "--brand-bg": brand.backgroundColor,
    "--brand-bg-text": readableTextColor(brand.backgroundColor),
    "--brand-primary": brand.primaryColor,
    "--brand-primary-text": readableTextColor(brand.primaryColor),
    "--brand-accent": accent,
    "--brand-accent-text": readableTextColor(accent)
  } as CSSProperties;
}

export function DinerBrandHeader({
  brand,
  googleReviewUrl
}: {
  brand: PublicBrandView | null;
  googleReviewUrl?: string | null;
}) {
  if (!brand && !googleReviewUrl) return null;
  const appearance = brand?.appearance;
  return (
    <header
      className="diner-brand"
      data-layout={appearance?.layout}
      data-heading={appearance?.headingStyle}
    >
      <div className="diner-brand__bar">
        {brand?.logoVersion ? (
          // eslint-disable-next-line @next/next/no-img-element -- icon served by the brand endpoint
          <img
            alt=""
            className="diner-brand__logo"
            height={48}
            src={brandIconUrl(192, { version: brand.logoVersion })}
            width={48}
          />
        ) : null}
        {brand ? <span className="diner-brand__name">{brand.name}</span> : null}
        {googleReviewUrl ? (
          <a
            className="button button--secondary diner-brand__review"
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Dejar reseña en Google"
          >
            Dejar reseña
          </a>
        ) : null}
      </div>
      {brand?.coverVersion ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover is resolved by the restaurant domain
        <img
          className="diner-brand__cover"
          alt=""
          src={"/api/brand/cover?v=" + brand.coverVersion}
        />
      ) : null}
      {appearance?.description ? (
        <p className="diner-brand__description">{appearance.description}</p>
      ) : null}
    </header>
  );
}
