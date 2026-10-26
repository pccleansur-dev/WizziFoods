import type { MetadataRoute } from "next";

/**
 * Minimal manifest so the page can be added to the home screen, which iPhones require
 * before they allow notifications. Icons and offline support belong to T31.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    display: "standalone",
    lang: "es",
    name: "Mozo",
    short_name: "Mozo",
    start_url: "/cuenta",
    theme_color: "#ffffff"
  };
}
