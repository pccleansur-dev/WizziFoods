import type { CatalogIssueView } from "./catalog-issues";

/**
 * Qué hay que corregir para poder guardar y dónde: cada ítem lleva a la fila.
 * Se calcula en vivo sobre el borrador, así desaparece al corregirlo.
 */
export function CatalogIssueList({ issues }: { issues: CatalogIssueView[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="catalog-issues" role="alert">
      <strong>Para guardar, corregí esto:</strong>
      <ul>
        {issues.map((issue, index) => (
          <li
            key={`${issue.id ?? "draft"}-${issue.field}-${issue.language ?? ""}-${index}`}
          >
            {issue.id ? (
              <a href={`#catalog-row-${issue.id}`}>{issue.label}</a>
            ) : (
              <span>{issue.label}</span>
            )}
            : {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
