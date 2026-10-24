export type WaiterActionResult<T> =
  | { data: T; status: "ok" }
  | { code: string | null; message: string; status: "error" };
