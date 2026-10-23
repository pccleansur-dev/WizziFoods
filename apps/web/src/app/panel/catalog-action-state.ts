export type CatalogActionState = {
  draftRevision: number | null;
  message: string;
  publishedRevision: number | null;
  status: "error" | "idle" | "success";
};
