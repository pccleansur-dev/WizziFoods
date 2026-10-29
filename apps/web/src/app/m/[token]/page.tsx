import type { Metadata } from "next";
import { headers } from "next/headers";

import { DinerAccountBar } from "../../diner-account/diner-account-bar";
import { loadBrand } from "../../../lib/brand";
import { DinerBrandHeader, dinerBrandStyle } from "./diner-brand-header";
import { EntryRefresh } from "./entry-refresh";
import { EntryView } from "./entry-view";
import { DinerExperience } from "./diner-experience";
import { loadPublicCatalog } from "./public-catalog";
import { loadOrderIntentOptions } from "./order-intent-options";
import { loadTableEntry } from "./table-entry";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBrand((await headers()).get("host") ?? "");
  return {
    referrer: "no-referrer",
    robots: { follow: false, index: false },
    title: brand ? `${brand.name} · Tu mesa` : "Tu mesa"
  };
}

export default async function TableEntryPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const host = (await headers()).get("host") ?? "";
  const [result, catalog, paymentMethods, brand] = await Promise.all([
    loadTableEntry(host, token),
    loadPublicCatalog(host),
    loadOrderIntentOptions(host),
    loadBrand(host)
  ]);
  return (
    <main
      className={brand ? "diner-branded" : undefined}
      style={dinerBrandStyle(brand)}
    >
      <DinerBrandHeader brand={brand} />
      <EntryView result={result} />
      {result.status === "ok" ? <DinerAccountBar token={token} /> : null}
      {result.status === "ok" ? (
        <>
          <DinerExperience
            catalog={catalog}
            paymentMethods={paymentMethods}
            token={token}
          />
          <EntryRefresh token={token} />
        </>
      ) : null}
    </main>
  );
}
