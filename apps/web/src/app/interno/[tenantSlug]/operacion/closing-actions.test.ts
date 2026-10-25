import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieValue = vi.fn<(name: string) => string | undefined>();
const fetchMock = vi.fn();

vi.mock("@platform/config", () => ({
  readWebConfig: () => ({ apiUrl: "http://api.localhost:3001" })
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValue(name);
      return value === undefined ? undefined : { value };
    }
  })
}));

const token = "A".repeat(43);
const commandId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

const receipt = {
  businessName: "Parrilla Sur",
  closedAt: "2026-10-25T20:30:00.000Z",
  currency: "ARS",
  discounts: [],
  invoiceNotice:
    "¿Necesitás factura? Por el momento, la facturación se realiza en caja",
  items: [],
  locationName: "Salón",
  notice: "Comprobante de consumo — no válido como factura",
  number: 4,
  openedAt: "2026-10-25T19:00:00.000Z",
  payments: [],
  refunds: [],
  sessionId,
  summary: {
    consumedCents: 0,
    discountCents: 0,
    paidCents: 0,
    pendingCents: 0,
    refundedCents: 0,
    tipCents: 0
  },
  tableLabels: ["2"]
};

describe("table closing server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("closes an account through the session cookie with only a command id", async () => {
    const result = {
      closedAt: "2026-10-25T20:30:00.000Z",
      receipt,
      sessionId,
      tables: [{ label: "2", state: "needs_cleaning", tableId }]
    };
    fetchMock.mockResolvedValue(json(200, { data: result }));
    const { closeAccountAction } = await import("./closing-actions");
    await expect(
      closeAccountAction("bar", sessionId, { commandId })
    ).resolves.toEqual({
      data: { ...result, receipt: { ...receipt, cashierRequest: null } },
      status: "ok"
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/close`
    );
    expect(init.headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body)).toEqual({ commandId });
  });

  it("explains a refusal in words and never leaks the response", async () => {
    fetchMock.mockResolvedValue(
      json(409, { error: { code: "BALANCE_NOT_SETTLED", message: "x" } })
    );
    const { closeAccountAction } = await import("./closing-actions");
    const result = await closeAccountAction("bar", sessionId, { commandId });
    expect(result).toMatchObject({
      code: "BALANCE_NOT_SETTLED",
      status: "error"
    });
    expect(result.status === "error" && result.message).toMatch(/saldo/u);
  });

  it("refuses malformed identifiers and extra fields before calling the API", async () => {
    const { cleanTableAction, closeAccountAction, requestCashierAction } =
      await import("./closing-actions");
    await expect(
      closeAccountAction("bar", "nope", { commandId })
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      cleanTableAction("bar", tableId, {
        commandId,
        state: "available"
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    await expect(
      requestCashierAction("bar", sessionId, {
        commandId,
        cuit: "20-12345678-9"
      } as never)
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans a table, asks the cashier and resolves the request on their own routes", async () => {
    const {
      cleanTableAction,
      requestCashierAction,
      resolveCashierRequestAction
    } = await import("./closing-actions");
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { state: "available", tableId } })
    );
    await cleanTableAction("bar", tableId, { commandId });
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: { receiptNumber: 4, requestId, sessionId, status: "open" }
      })
    );
    await requestCashierAction("bar", sessionId, { commandId });
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { requestId, status: "resolved" } })
    );
    await resolveCashierRequestAction("bar", requestId, { commandId });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.localhost:3001/v1/staff/tables/${tableId}/clean`,
      `http://api.localhost:3001/v1/staff/accounts/${sessionId}/cashier-requests`,
      `http://api.localhost:3001/v1/staff/cashier-requests/${requestId}/resolve`
    ]);
  });

  it("reads a receipt only when it is canonical", async () => {
    const { getReceiptAction } = await import("./closing-actions");
    fetchMock.mockResolvedValueOnce(json(200, { data: receipt }));
    await expect(getReceiptAction("bar", sessionId)).resolves.toMatchObject({
      data: { number: 4 },
      status: "ok"
    });
    fetchMock.mockResolvedValueOnce(
      json(200, { data: { ...receipt, notice: "Factura" } })
    );
    await expect(getReceiptAction("bar", sessionId)).resolves.toMatchObject({
      status: "error"
    });
  });

  it("asks for a new sign-in when the session is gone", async () => {
    cookieValue.mockReturnValue(undefined);
    const { closeAccountAction } = await import("./closing-actions");
    await expect(
      closeAccountAction("bar", sessionId, { commandId })
    ).resolves.toMatchObject({ code: "STAFF_SESSION_INVALID" });
  });
});
