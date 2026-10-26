import { describe, expect, it } from "vitest";

import {
  parseJoinTablesCommand,
  parseJoinTablesResult,
  parseSeparateTablesCommand,
  parseSeparateTablesResult
} from "./table-regrouping.js";

const commandId = "11111111-1111-4111-8111-111111111111";
const tableA = "22222222-2222-4222-8222-222222222222";
const tableB = "33333333-3333-4333-8333-333333333333";
const tableC = "44444444-4444-4444-8444-444444444444";
const groupId = "55555555-5555-4555-8555-555555555555";
const sessionId = "66666666-6666-4666-8666-666666666666";

describe("join tables command", () => {
  it("accepts two to twenty different tables and an optional name", () => {
    expect(
      parseJoinTablesCommand({ commandId, tableIds: [tableA, tableB] })
    ).toEqual({ commandId, name: null, tableIds: [tableA, tableB] });
    expect(
      parseJoinTablesCommand({
        commandId,
        name: "  Cumpleaños ",
        tableIds: [tableA, tableB, tableC]
      })
    ).toEqual({
      commandId,
      name: "Cumpleaños",
      tableIds: [tableA, tableB, tableC]
    });
  });

  it("rejects a single table, repeated tables and more than twenty", () => {
    expect(
      parseJoinTablesCommand({ commandId, tableIds: [tableA] })
    ).toBeNull();
    expect(
      parseJoinTablesCommand({ commandId, tableIds: [tableA, tableA] })
    ).toBeNull();
    const many = Array.from(
      { length: 21 },
      (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`
    );
    expect(parseJoinTablesCommand({ commandId, tableIds: many })).toBeNull();
  });

  it("rejects ids that are not uuids, extra fields and bad names", () => {
    expect(
      parseJoinTablesCommand({ commandId, tableIds: [tableA, "mesa-2"] })
    ).toBeNull();
    expect(
      parseJoinTablesCommand({ commandId: "x", tableIds: [tableA, tableB] })
    ).toBeNull();
    expect(
      parseJoinTablesCommand({
        commandId,
        tableIds: [tableA, tableB],
        tenantId: tableC
      })
    ).toBeNull();
    expect(
      parseJoinTablesCommand({
        commandId,
        name: "x".repeat(61),
        tableIds: [tableA, tableB]
      })
    ).toBeNull();
    expect(
      parseJoinTablesCommand({
        commandId,
        name: "a\nb",
        tableIds: [tableA, tableB]
      })
    ).toBeNull();
    expect(parseJoinTablesCommand("nope")).toBeNull();
  });

  it("treats a blank name as no name", () => {
    expect(
      parseJoinTablesCommand({
        commandId,
        name: "   ",
        tableIds: [tableA, tableB]
      })
    ).toEqual({ commandId, name: null, tableIds: [tableA, tableB] });
  });
});

describe("separate tables command", () => {
  it("accepts an anchor or none", () => {
    expect(
      parseSeparateTablesCommand({ anchorTableId: tableA, commandId })
    ).toEqual({ anchorTableId: tableA, commandId });
    expect(parseSeparateTablesCommand({ commandId })).toEqual({
      anchorTableId: null,
      commandId
    });
    expect(
      parseSeparateTablesCommand({ anchorTableId: null, commandId })
    ).toEqual({ anchorTableId: null, commandId });
  });

  it("rejects a bad anchor and extra fields", () => {
    expect(
      parseSeparateTablesCommand({ anchorTableId: "1", commandId })
    ).toBeNull();
    expect(parseSeparateTablesCommand({ commandId, groupId })).toBeNull();
    expect(parseSeparateTablesCommand(null)).toBeNull();
  });
});

describe("regrouping results", () => {
  const tables = [
    { label: "1", state: "occupied", tableId: tableA },
    { label: "2", state: "occupied", tableId: tableB }
  ];

  it("parses a join result", () => {
    const result = {
      groupId,
      mergedGroupIds: [],
      name: "Cumpleaños",
      sessionId,
      tables
    };
    expect(parseJoinTablesResult(result)).toEqual(result);
    expect(parseJoinTablesResult({ ...result, sessionId: null })).toEqual({
      ...result,
      sessionId: null
    });
  });

  it("rejects a join result with an unknown state or extra field", () => {
    const base = { groupId, mergedGroupIds: [], name: "G", sessionId: null };
    expect(
      parseJoinTablesResult({
        ...base,
        tables: [{ label: "1", state: "broken", tableId: tableA }]
      })
    ).toBeNull();
    expect(parseJoinTablesResult({ ...base, tables, extra: 1 })).toBeNull();
    expect(parseJoinTablesResult({ ...base, tables: [] })).toBeNull();
  });

  it("parses a separate result and keeps the released tables", () => {
    const result = {
      anchorTableId: tableB,
      groupId,
      name: "Cumpleaños",
      releasedTableIds: [tableA],
      sessionId,
      tables: [
        { label: "1", state: "available", tableId: tableA },
        { label: "2", state: "occupied", tableId: tableB }
      ]
    };
    expect(parseSeparateTablesResult(result)).toEqual(result);
    expect(
      parseSeparateTablesResult({
        ...result,
        anchorTableId: null,
        sessionId: null
      })
    ).toMatchObject({ anchorTableId: null, sessionId: null });
  });

  it("rejects a separate result whose anchor does not carry the account", () => {
    expect(
      parseSeparateTablesResult({
        anchorTableId: null,
        groupId,
        name: "G",
        releasedTableIds: [],
        sessionId,
        tables
      })
    ).toBeNull();
    expect(
      parseSeparateTablesResult({
        anchorTableId: tableA,
        groupId,
        name: "G",
        releasedTableIds: [tableA],
        sessionId,
        tables
      })
    ).toBeNull();
  });
});
