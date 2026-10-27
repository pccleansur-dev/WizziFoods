import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PwaRegistrar } from "../lib/pwa-registrar";
import "./styles.css";

export const metadata: Metadata = {
  description: "Base técnica de la plataforma para gastronomía.",
  // iPhones use this one for the home screen; the address is the same on every host and
  // the API answers with the logo of the restaurant that is asked.
  icons: { apple: "/api/brand/icon?size=180" },
  title: "La plataforma"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <PwaRegistrar />
      </body>
    </html>
  );
}
