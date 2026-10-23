export type TenantSuspensionActionState = {
  message: string;
  status: "error" | "idle" | "success";
};
