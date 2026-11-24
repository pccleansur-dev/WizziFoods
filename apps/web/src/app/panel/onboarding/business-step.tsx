import type { ReactNode } from "react";

import type { SavedBusinessProfileDraft } from "../business-profile";
import { BusinessProfileForm } from "../business-profile-form";
import { editableBusinessProfile } from "./editable-profile";

/** Paso 1: datos del negocio e identidad visual. */
export function BusinessStep({
  businessProfile,
  hoursPanel,
  reviewPanel,
  tenantName
}: {
  businessProfile: SavedBusinessProfileDraft | null;
  tenantName: string;
  hoursPanel?: ReactNode;
  reviewPanel?: ReactNode;
}) {
  return (
    <div className="panel-content onboarding-step-content">
      <BusinessProfileForm
        hoursPanel={hoursPanel}
        reviewPanel={reviewPanel}
        draft={editableBusinessProfile(businessProfile, tenantName)}
      />
    </div>
  );
}
