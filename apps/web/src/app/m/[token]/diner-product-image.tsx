"use client";

import { catalogImagePath } from "@platform/contracts";
import { useState } from "react";

/**
 * Space for a product photo. The photo is the one the Administrator chose, served by the
 * restaurant's own host; a product with no photo shows a neutral tile with its initial,
 * and so does a photo that fails to load, with the same layout.
 */
export function DinerProductImage({
  imageAssetId = null,
  size,
  title
}: {
  imageAssetId?: string | null;
  size: "card" | "hero";
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = imageAssetId && !failed ? catalogImagePath(imageAssetId) : null;
  return (
    <span aria-hidden="true" className={`diner-image diner-image--${size}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- slot sized by CSS
        <img alt="" loading="lazy" onError={() => setFailed(true)} src={src} />
      ) : (
        <span>{title.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}
