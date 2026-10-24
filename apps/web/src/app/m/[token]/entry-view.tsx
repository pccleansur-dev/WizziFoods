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

const viewOnlyLead = {
  needs_cleaning:
    "Estamos preparando esta mesa. Mientras tanto podés mirar la carta y llamar al mozo; todavía no podés hacer el pedido.",
  not_accepting:
    "Por hoy el local no abre mesas nuevas. Podés mirar la carta y llamar al mozo.",
  out_of_service:
    "Esta mesa no está disponible. Podés mirar la carta y llamar al mozo, que te va a ayudar a sentarte en otra."
} as const;

function tablesPhrase(labels: string[]): string {
  if (labels.length < 2) return `mesa ${labels[0] ?? ""}`.trim();
  return `mesas ${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

export function EntryView({ result }: { result: TableEntryResult }) {
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
  const lead =
    entry.mode === "view_only" && entry.reason
      ? viewOnlyLead[entry.reason]
      : entry.mode === "join"
        ? "Tu mesa ya está abierta: te sumás al pedido de la mesa."
        : "La mesa está lista. Ya podés ver la carta y armar tu pedido.";
  return (
    <section aria-labelledby="entry-title" className="diner-entry">
      <p className="eyebrow">{entry.table.floorName}</p>
      <h1 id="entry-title">Mesa {entry.table.label}</h1>
      {entry.group ? (
        <p className="diner-group">
          Estás en {entry.group.name} ({tablesPhrase(entry.group.tableLabels)})
        </p>
      ) : null}
      <p className="diner-lead">{lead}</p>
      <p className="diner-abilities-title">En esta mesa:</p>
      <ul className="diner-abilities">
        <li>Ver la carta</li>
        <li>
          {entry.canCallWaiter
            ? "Llamar al mozo"
            : "Llamar al mozo no disponible"}
        </li>
        <li>
          {entry.canConfirmOrder
            ? "Hacer el pedido"
            : "El pedido lo toma el mozo"}
        </li>
      </ul>
    </section>
  );
}
