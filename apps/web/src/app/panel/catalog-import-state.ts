export type CatalogImportActionState = {
  idempotencyKey: string;
  message: string;
  status: "error" | "idle" | "success";
};
