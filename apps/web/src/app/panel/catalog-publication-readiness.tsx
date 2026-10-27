import {
  catalogPublicationIssues,
  type CatalogDraft,
  type CatalogPublicationIssue
} from "@platform/contracts";

const requirements: Array<{
  issue: CatalogPublicationIssue | "MISSING_BUSINESS_IDENTITY";
  label: string;
}> = [
  {
    issue: "MISSING_BUSINESS_IDENTITY",
    label: "Identidad básica guardada"
  },
  { issue: "MISSING_CATEGORY", label: "Al menos una categoría" },
  { issue: "MISSING_SECTOR", label: "Al menos un sector" },
  { issue: "MISSING_PRODUCT", label: "Al menos un producto" },
  {
    issue: "MISSING_LOCALIZED_CONTENT",
    label: "Nombres completos en todos los idiomas"
  },
  {
    issue: "PENDING_TRANSLATION_REVIEW",
    label: "Traducciones automáticas revisadas y aprobadas"
  }
];

function readinessIssues(
  draft: CatalogDraft,
  languages: string[],
  hasBusinessProfile: boolean
) {
  return new Set<string>([
    ...(hasBusinessProfile ? [] : ["MISSING_BUSINESS_IDENTITY"]),
    ...catalogPublicationIssues(draft, languages)
  ]);
}

export function catalogIsReadyToPublish(
  draft: CatalogDraft,
  languages: string[],
  hasBusinessProfile: boolean
): boolean {
  return readinessIssues(draft, languages, hasBusinessProfile).size === 0;
}

export function CatalogPublicationReadiness({
  draft,
  hasBusinessProfile,
  languages
}: {
  draft: CatalogDraft;
  hasBusinessProfile: boolean;
  languages: string[];
}) {
  const issues = readinessIssues(draft, languages, hasBusinessProfile);
  const ready = issues.size === 0;

  return (
    <section
      className={`catalog-readiness ${ready ? "catalog-readiness--ready" : ""}`}
      aria-labelledby="catalog-readiness-title"
    >
      <div>
        <h3 id="catalog-readiness-title">Requisitos de publicación</h3>
        <p>{ready ? "Lista para publicar" : "Completá lo pendiente"}</p>
      </div>
      <ul>
        {requirements.map(({ issue, label }) => {
          const complete = !issues.has(issue);
          return (
            <li key={issue}>
              <span aria-label={complete ? "Completo" : "Pendiente"}>
                {complete ? "✓" : "·"}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
