import {
  parseFloorPlanCommand,
  type FloorPlanCommand,
  type FloorPlanIssue
} from "@platform/contracts";

export class FloorPlanInputError extends Error {
  constructor(readonly issues: FloorPlanIssue[]) {
    super("Datos del plano inválidos.");
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const tokenPattern = /^[0-9a-f]{64}$/u;

export function parseFloorPlanRequest(input: unknown): FloorPlanCommand {
  const parsed = parseFloorPlanCommand(input);
  if (!parsed.ok) throw new FloorPlanInputError(parsed.issues);
  return parsed.command;
}

export function parseFloorTableId(input: unknown): string {
  if (typeof input !== "string" || !uuidPattern.test(input)) {
    throw new Error("Mesa inválida.");
  }
  return input.toLowerCase();
}

export function parseQrVerifyRequest(input: unknown): { token: string } {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).join() !== "token" ||
    typeof (input as { token: unknown }).token !== "string" ||
    !tokenPattern.test((input as { token: string }).token)
  ) {
    throw new Error("Código QR inválido.");
  }
  return { token: (input as { token: string }).token };
}
