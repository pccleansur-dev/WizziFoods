export type CreateTenantProvisioningRequest = {
  adminEmail: string;
  name: string;
  slug: string;
};

export type TenantProvisioningStatus =
  "pending_invitation" | "invited" | "activated";

export type TenantProvisioningView = {
  adminEmail: string;
  location: { id: string; name: string };
  requestId: string;
  status: TenantProvisioningStatus;
  tenant: { id: string; name: string; slug: string };
};
