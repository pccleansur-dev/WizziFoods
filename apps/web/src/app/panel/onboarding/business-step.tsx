import type { SavedBusinessProfileDraft } from "../business-profile";
import { BusinessProfileForm } from "../business-profile-form";
import { editableBusinessProfile } from "./editable-profile";

/** Paso 1: datos del negocio e identidad visual. */
export function BusinessStep({
  businessProfile,
  tenantName
}: {
  businessProfile: SavedBusinessProfileDraft | null;
  tenantName: string;
}) {
  return (
    <div className="panel-content onboarding-step-content">
      <BusinessProfileForm
        draft={editableBusinessProfile(businessProfile, tenantName)}
      />
    </div>
  );
}
