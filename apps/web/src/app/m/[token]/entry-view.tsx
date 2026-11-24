import type { TableEntryResult } from "./table-entry";

type Content = { lead: string; title: string };

const closed: Record<string, Content> = {
  error: {
    lead: "No pudimos abrir la mesa. Volvé a escanear el código en un momento.",
    title: "Algo salió mal"
  },
  invalid: {
    lead: "Este código QR no es válido o ya no funciona. Pedile uno nuevo al personal del local.",
    title: "No reconocemos este código"
  },
  unavailable: {
    lead: "Este local todavía no recibe pedidos por QR. Consultale al personal.",
    title: "Este local aún no está abierto"
  },
  unreachable: {
    lead: "Este local no está disponible por ahora. Consultale al personal.",
    title: "Local no disponible"
  }
};

function tablesPhrase(labels: string[]): string {
  if (labels.length < 2) return `mesa ${labels[0] ?? ""}`.trim();
  return `mesas ${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

export function EntryView({
  result,
  hasCatalog = false
}: {
  result: TableEntryResult;
  hasCatalog?: boolean;
}) {
  if (result.status !== "ok") {
    const content = closed[result.status] ?? closed.error!;
    return (
      <section
        aria-labelledby="entry-title"
        className="diner-entry"
        role="alert"
      >
        <p className="eyebrow">Mesa por QR</p>
        <h1 id="entry-title">{content.title}</h1>
        <p className="diner-lead">{content.lead}</p>
      </section>
    );
  }

  const { entry } = result;
  const unavailable = !entry.canConfirmOrder;
  const message =
    entry.reason === "needs_cleaning"
      ? "Estamos preparando esta mesa"
      : entry.reason === "not_accepting"
        ? "Por hoy el local no abre mesas nuevas"
        : "Esta mesa no está disponible";
  return (
    <section
      aria-labelledby="entry-title"
      className="diner-entry diner-entry--compact"
    >
      <h1 id="entry-title">Mesa {entry.table.label}</h1>
      <p className="eyebrow">{entry.table.floorName}</p>
      {entry.group ? (
        <p className="diner-group">
          Estás en {entry.group.name} ({tablesPhrase(entry.group.tableLabels)})
        </p>
      ) : null}
      {unavailable ? (
        <div className="diner-entry__status">
          <p className="diner-lead">
            {message}.{" "}
            {entry.canCallWaiter
              ? "Llamá al mozo si necesitás que te atienda."
              : "Consultá al personal del local."}
          </p>
          {hasCatalog ? (
            <a className="button button--secondary" href="#carta">
              Ver la carta
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
