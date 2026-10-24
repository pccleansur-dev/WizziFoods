import type { SavedBusinessProfileDraft } from "../business-profile";
import type { PublishedCatalog, SavedCatalogDraft } from "../catalog";
import { CatalogEditor } from "../catalog-editor";
import type { CatalogImportView } from "../catalog-import";
import { CatalogImportPanel } from "../catalog-import-panel";
import { editableBusinessProfile } from "./editable-profile";

/** Paso 2: importación asistida y editor de la carta. */
export function CartaStep({
  businessProfile,
  catalog,
  catalogImports,
  idempotencyKey,
  publishedCatalog,
  tenantName
}: {
  businessProfile: SavedBusinessProfileDraft | null;
  catalog: SavedCatalogDraft | null;
  catalogImports: CatalogImportView[];
  idempotencyKey: string;
  publishedCatalog: PublishedCatalog | null;
  tenantName: string;
}) {
  const profile = editableBusinessProfile(businessProfile, tenantName);
  return (
    <div className="panel-content onboarding-step-content">
      <CatalogImportPanel
        idempotencyKey={idempotencyKey}
        imports={catalogImports}
      />
      <CatalogEditor
        catalog={catalog}
        hasBusinessProfile={businessProfile !== null}
        languages={profile.languages}
        publishedCatalog={publishedCatalog}
      />
    </div>
  );
}
