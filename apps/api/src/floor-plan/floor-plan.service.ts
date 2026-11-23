import { Injectable } from "@nestjs/common";
import type { FloorPlanCommand } from "@platform/contracts";
import type {
  FloorPlanRecord,
  FloorPlanRepository,
  FloorPlanSaveRecord,
  FloorTableQrCode,
  FloorTableQrResolution
} from "@platform/database";
import qrcode from "qrcode-generator";

import type { StaffRequestContext } from "../staff-auth/staff-session.guard.js";
import type { TenantAdminRequestContext } from "../tenants/tenant-admin-scope.service.js";

export type FloorTableQrDownload = {
  label: string;
  svg: string;
  tableId: string;
  url: string;
};

export type FloorQrVerification =
  { table: FloorTableQrResolution; valid: true } | { valid: false };

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

/** The QR carries only the opaque token: no tenant, location or table id. */
function qrUrl(hostname: string, token: string): string {
  const scheme = isLocalHost(hostname) ? "http" : "https";
  return `${scheme}://${hostname}/m/${token}`;
}

function renderSvg(url: string): string {
  const code = qrcode(0, "M");
  code.addData(url, "Byte");
  code.make();
  return code.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

function renderDownloads(codes: FloorTableQrCode[], hostname: string) {
  return codes.map(({ label, tableId, token }) => {
    const url = qrUrl(hostname, token);
    return { label, svg: renderSvg(url), tableId, url };
  });
}

@Injectable()
export class FloorPlanService {
  constructor(private readonly floorPlanRepository: FloorPlanRepository) {}

  getPlan(context: TenantAdminRequestContext): Promise<FloorPlanRecord> {
    return this.floorPlanRepository.getPlan(
      context.scope,
      context.identity.userId
    );
  }

  savePlan(
    context: TenantAdminRequestContext,
    command: FloorPlanCommand
  ): Promise<FloorPlanSaveRecord> {
    return this.floorPlanRepository.savePlan({
      command,
      requesterId: context.identity.userId,
      scope: context.scope
    });
  }

  async getStaffPlan(context: StaffRequestContext) {
    const { plan, version, hostname, codes } =
      await this.floorPlanRepository.getStaffPlan(
        context.scope,
        context.staffId
      );
    return {
      plan,
      version,
      qr: hostname ? renderDownloads(codes, hostname) : []
    };
  }

  saveStaffPlan(context: StaffRequestContext, command: FloorPlanCommand) {
    return this.floorPlanRepository.savePlan({
      command,
      requesterId: context.staffId,
      scope: context.scope,
      staff: true
    });
  }

  async listQrCodes(
    context: TenantAdminRequestContext
  ): Promise<FloorTableQrDownload[]> {
    const codes = await this.floorPlanRepository.listQrCodes(
      context.scope,
      context.identity.userId
    );
    return renderDownloads(codes, context.domain.hostname);
  }

  async verifyQr(
    context: TenantAdminRequestContext,
    token: string
  ): Promise<FloorQrVerification> {
    const table = await this.floorPlanRepository.resolveQr(
      context.scope,
      token
    );
    return table ? { table, valid: true } : { valid: false };
  }

  rotateQr(context: TenantAdminRequestContext, tableId: string): Promise<void> {
    return this.floorPlanRepository.rotateQr({
      requesterId: context.identity.userId,
      scope: context.scope,
      tableId
    });
  }
}
