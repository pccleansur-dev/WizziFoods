import { AccountPanel } from "./account-panel";

export const dynamic = "force-dynamic";

export const metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Tu cuenta"
};

export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ volver?: string | string[] }>;
}) {
  const { volver } = await searchParams;
  return (
    <main>
      <section aria-labelledby="account-title">
        <h1 id="account-title">Tu cuenta</h1>
        <AccountPanel
          back={Array.isArray(volver) ? (volver[0] ?? "/") : (volver ?? "/")}
        />
      </section>
    </main>
  );
}
