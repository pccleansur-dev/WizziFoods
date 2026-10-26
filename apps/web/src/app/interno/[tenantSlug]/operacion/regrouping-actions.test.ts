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
const tableA = "22222222-2222-4222-8222-222222222222";
const tableB = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

const joined = {
  groupId,
  mergedGroupIds: [],
  name: "Cumple",
  sessionId: null,
  tables: [
    { label: "1", state: "available", tableId: tableA },
    { label: "2", state: "available", tableId: tableB }
  ]
};

describe("table regrouping server actions", () => {
  beforeEach(() => {
    cookieValue.mockReset().mockReturnValue(token);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("joins tables through the session cookie with only tables, name and command", async () => {
    fetchMock.mockResolvedValue(json(200, { data: joined }));
    const { joinTablesAction } = await import("./regrouping-actions");
    await expect(
      joinTablesAction("bar", {
        commandId,
        name: "Cumple",
        tableIds: [tableA, tableB]
      })
    ).resolves.toEqual({ data: joined, status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.localhost:3001/v1/staff/table-groups");
    expect(JSON.parse(init.body as string)).toEqual({
      commandId,
      name: "Cumple",
      tableIds: [tableA, tableB]
    });
    expect(JSON.stringify(init)).not.toContain("tenant");
  });

  it("separates a group with the anchor table", async () => {
    const result = {
      anchorTableId: tableB,
      groupId,
      name: "Cumple",
      releasedTableIds: [tableA],
      sessionId,
      tables: [
        { label: "1", state: "available", tableId: tableA },
        { label: "2", state: "occupied", tableId: tableB }
      ]
    };
    fetchMock.mockResolvedValue(json(200, { data: result }));
    const { separateTablesAction } = await import("./regrouping-actions");
    await expect(
      separateTablesAction("bar", groupId, {
        anchorTableId: tableB,
        commandId
      })
    ).resolves.toEqual({ data: result, status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `http://api.localhost:3001/v1/staff/table-groups/${groupId}/separate`
    );
    expect(JSON.parse(init.body as string)).toEqual({
      anchorTableId: tableB,
      commandId
    });
  });

  it("refuses a bad request before calling the API", async () => {
    const { joinTablesAction, separateTablesAction } =
      await import("./regrouping-actions");
    await expect(
      joinTablesAction("bar", { commandId, name: null, tableIds: [tableA] })
    ).resolves.toMatchObject({
      code: "INVALID_TABLE_REGROUPING_REQUEST",
      status: "error"
    });
    await expect(
      separateTablesAction("bar", "nope", { anchorTableId: null, commandId })
    ).resolves.toMatchObject({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains refusals in plain Spanish and flags a lost session", async () => {
    const { joinTablesAction } = await import("./regrouping-actions");
    fetchMock.mockResolvedValue(
      json(409, {
        error: { code: "DIFFERENT_OPEN_ACCOUNTS", message: "x" }
      })
    );
    const refused = await joinTablesAction("bar", {
      commandId,
      name: null,
      tableIds: [tableA, tableB]
    });
    expect(refused).toMatchObject({
      code: "DIFFERENT_OPEN_ACCOUNTS",
      status: "error"
    });
    expect(refused.status === "error" && refused.message).toMatch(
      /cuentas abiertas distintas/u
    );
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(
      joinTablesAction("bar", {
        commandId,
        name: null,
        tableIds: [tableA, tableB]
      })
    ).resolves.toMatchObject({ code: "STAFF_SESSION_INVALID" });
  });

  it("turns a network failure into a retryable error", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { joinTablesAction } = await import("./regrouping-actions");
    await expect(
      joinTablesAction("bar", {
        commandId,
        name: null,
        tableIds: [tableA, tableB]
      })
    ).resolves.toMatchObject({ code: null, status: "error" });
  });
});
