export type CatalogAvailabilityActionState = {
  isAvailable: boolean;
  message: string;
  status: "error" | "idle" | "success";
  version: number | null;
};
