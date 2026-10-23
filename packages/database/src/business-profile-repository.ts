import {
  parseBusinessProfileDraft,
  parseTenantScope,
  type BusinessProfileDraft,
  type TenantScope
} from "@platform/contracts";
import type { Sql } from "postgres";

export type BusinessProfileDraftRecord = BusinessProfileDraft & {
  revision: number;
  updatedAt: string;
};

export type SaveBusinessProfileDraftInput = {
  draft: BusinessProfileDraft;
  requesterId: string;
  scope: TenantScope;
};

export interface BusinessProfileRepository {
  getDraft(
    scope: TenantScope,
    requesterId: string
  ): Promise<BusinessProfileDraftRecord | null>;
  saveDraft(
    input: SaveBusinessProfileDraftInput
  ): Promise<BusinessProfileDraftRecord>;
}

type BusinessProfileRow = {
  accent_color: string;
  address: string;
  contact_phone: string;
  cover_asset_id: string | null;
  description: string;
  display_name: string;
  heading_style: BusinessProfileDraft["visual"]["headingStyle"];
  languages: string[];
  logo_asset_id: string | null;
  opening_hours: string;
  primary_color: string;
  reference_asset_ids: string[];
  revision: number;
  secondary_color: string;
  updated_at: Date | string;
  visual_layout: BusinessProfileDraft["visual"]["layout"];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertScope(scope: TenantScope): TenantScope {
  const parsed = parseTenantScope(scope);
  if (!parsed) throw new Error("tenant scope must be canonical");
  return parsed;
}

function assertRequester(requesterId: string): void {
  if (!uuidPattern.test(requesterId)) {
    throw new Error("requesterId must be a UUID");
  }
}

function assertDraft(draft: BusinessProfileDraft): BusinessProfileDraft {
  const parsed = parseBusinessProfileDraft(draft);
  if (!parsed) throw new Error("business profile draft must be canonical");
  return parsed;
}

function toIsoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("updated_at must be a valid timestamp");
  }
  return timestamp.toISOString();
}

function mapRow(row: BusinessProfileRow): BusinessProfileDraftRecord {
  return {
    address: row.address,
    contactPhone: row.contact_phone,
    coverAssetId: row.cover_asset_id,
    description: row.description,
    displayName: row.display_name,
    languages: row.languages,
    logoAssetId: row.logo_asset_id,
    openingHours: row.opening_hours,
    referenceAssetIds: row.reference_asset_ids,
    revision: row.revision,
    updatedAt: toIsoTimestamp(row.updated_at),
    visual: {
      accentColor: row.accent_color,
      headingStyle: row.heading_style,
      layout: row.visual_layout,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color
    }
  };
}

export function createBusinessProfileRepository(
  client: Sql
): BusinessProfileRepository {
  return {
    async getDraft(untrustedScope, requesterId) {
      const scope = assertScope(untrustedScope);
      assertRequester(requesterId);
      const [row] = await client<BusinessProfileRow[]>`
        select *
        from private.get_business_profile_draft(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${requesterId}::uuid
        )
      `;
      return row ? mapRow(row) : null;
    },

    async saveDraft(input) {
      const scope = assertScope(input.scope);
      assertRequester(input.requesterId);
      const draft = assertDraft(input.draft);
      const [row] = await client<BusinessProfileRow[]>`
        select *
        from private.save_business_profile_draft(
          ${scope.tenantId}::uuid,
          ${scope.locationId}::uuid,
          ${input.requesterId}::uuid,
          ${draft.displayName},
          ${draft.description},
          ${draft.contactPhone},
          ${draft.address},
          ${draft.openingHours},
          ${draft.languages}::text[],
          ${draft.visual.layout},
          ${draft.visual.headingStyle},
          ${draft.visual.primaryColor},
          ${draft.visual.secondaryColor},
          ${draft.visual.accentColor},
          ${draft.logoAssetId}::uuid,
          ${draft.coverAssetId}::uuid,
          ${draft.referenceAssetIds}::uuid[]
        )
      `;
      if (!row)
        throw new Error("Business profile save did not return a record");
      return mapRow(row);
    }
  };
}
