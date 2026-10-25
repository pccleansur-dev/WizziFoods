import { createHash } from "node:crypto";

import {
  parseDinerSplitView,
  parseTenantScope,
  type DinerSplitView,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

type ResultRow = { result: unknown };

export interface SplitClaimsRepository {
  claim(input: {
    label: string;
    position: number;
    scope: TenantScope;
    secret: string;
    token: string;
  }): Promise<DinerSplitView>;
  release(input: {
    position: number;
    scope: TenantScope;
    secret: string;
    token: string;
  }): Promise<DinerSplitView>;
  view(input: {
    scope: TenantScope;
    secret: string;
    token: string;
  }): Promise<DinerSplitView>;
}

function assertScope(value: TenantScope): TenantScope {
  const parsed = parseTenantScope(value);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

/** The database only ever sees the hash of the device secret. */
function hash(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function canonical(value: unknown): DinerSplitView {
  const view = parseDinerSplitView(value);
  if (!view) throw new Error("split view must be canonical");
  return view;
}

export function createSplitClaimsRepository(
  client: Sql
): SplitClaimsRepository {
  return {
    async view(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.diner_account_split_view(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.token},
          ${hash(input.secret)}::bytea
        ) as result
      `;
      return canonical(row?.result);
    },

    async claim(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.claim_split_share(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.token},
          ${input.position}::integer,
          ${input.label},
          ${hash(input.secret)}::bytea
        ) as result
      `;
      return canonical(row?.result);
    },

    async release(input) {
      const scope = assertScope(input.scope);
      const [row] = await client<ResultRow[]>`
        select private.release_split_share(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.token},
          ${input.position}::integer,
          ${hash(input.secret)}::bytea
        ) as result
      `;
      return canonical(row?.result);
    }
  };
}
