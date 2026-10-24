import { headers } from "next/headers";

import { EntryRefresh } from "./entry-refresh";
import { EntryView } from "./entry-view";
import { loadTableEntry } from "./table-entry";

export const dynamic = "force-dynamic";

export const metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Tu mesa"
};

export default async function TableEntryPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const host = (await headers()).get("host") ?? "";
  const result = await loadTableEntry(host, token);
  return (
    <main>
      <EntryView result={result} />
      {result.status === "ok" ? <EntryRefresh /> : null}
    </main>
  );
}
