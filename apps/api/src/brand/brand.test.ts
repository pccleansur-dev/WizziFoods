import { BadRequestException, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { BrandController } from "./brand.controller.js";
import { renderBrandIcon } from "./brand-icon.js";
import { BrandService } from "./brand.service.js";

const id = "3c200000-0000-4000-8000-000000000001";
const scope = { locationId: id, tenantId: id };
const colors = { backgroundColor: "#EEEEEE", primaryColor: "#112233" };

async function wideLogo(): Promise<Buffer> {
  // 400x100, solid red: clearly not square.
  return sharp({
    create: {
      background: "#FF0000",
      channels: 3,
      height: 100,
      width: 400
    }
  })
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

describe("renderBrandIcon", () => {
  it("makes a square icon of the asked size with the logo centered on the background", async () => {
    const png = await renderBrandIcon({
      ...colors,
      logo: await wideLogo(),
      maskable: false,
      name: "La Parrilla",
      size: 192
    });
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 192, 192]);
    // The corner is the restaurant's background; the center is the logo.
    expect(await pixel(png, 2, 2)).toEqual([0xee, 0xee, 0xee]);
    expect(await pixel(png, 96, 96)).toEqual([0xff, 0, 0]);
  });

  it("keeps the logo smaller when the icon may be cropped to a circle", async () => {
    const plain = await renderBrandIcon({
      ...colors,
      logo: await wideLogo(),
      maskable: false,
      name: "La Parrilla",
      size: 512
    });
    const safe = await renderBrandIcon({
      ...colors,
      logo: await wideLogo(),
      maskable: true,
      name: "La Parrilla",
      size: 512
    });
    // 80% of the width is logo in one, 56% in the other.
    expect(await pixel(plain, 80, 256)).toEqual([0xff, 0, 0]);
    expect(await pixel(safe, 80, 256)).toEqual([0xee, 0xee, 0xee]);
  });

  it("never fails: with no logo, or one that cannot be read, it is a plain tile", async () => {
    for (const logo of [null, Buffer.from("this is not an image")]) {
      const png = await renderBrandIcon({
        ...colors,
        logo,
        maskable: false,
        name: "¡Mozo!",
        size: 192
      });
      const meta = await sharp(png).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", 192, 192]);
      expect(await pixel(png, 2, 2)).toEqual([0x11, 0x22, 0x33]);
    }
  });
});

function serviceWith(brand: unknown, download = vi.fn()) {
  const repository = { getBrand: vi.fn().mockResolvedValue(brand) };
  return {
    download,
    repository,
    service: new BrandService(repository as never, { download })
  };
}

const withLogo = {
  ...colors,
  logo: {
    contentType: "image/png",
    objectPath: `tenants/${id}/locations/${id}/business-profile/logo/${id}.png`,
    version: "abababababababab"
  },
  name: "La Parrilla"
};

describe("BrandService", () => {
  it("shows the public a version of the logo, never its path", async () => {
    const { service } = serviceWith(withLogo);
    const view = await service.view(scope);
    expect(view).toEqual({
      backgroundColor: "#EEEEEE",
      logoVersion: "abababababababab",
      name: "La Parrilla",
      primaryColor: "#112233"
    });
    expect(JSON.stringify(view)).not.toContain("tenants/");
  });

  it("reads the logo once and remembers the icon", async () => {
    const { download, service } = serviceWith(
      withLogo,
      vi.fn().mockResolvedValue(await wideLogo())
    );
    const first = await service.icon(scope, 192, false);
    const second = await service.icon(scope, 192, false);
    expect(second).toBe(first);
    expect(download).toHaveBeenCalledTimes(1);
    await service.icon(scope, 512, false);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("answers with a plain tile when the storage fails, and does not remember it", async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error("storage down"))
      .mockResolvedValue(await wideLogo());
    const { service } = serviceWith(withLogo, download);
    const tile = await service.icon(scope, 192, false);
    expect(await pixel(tile!, 96, 96)).not.toEqual([0xff, 0, 0]);
    const logo = await service.icon(scope, 192, false);
    expect(await pixel(logo!, 96, 96)).toEqual([0xff, 0, 0]);
  });

  it("has nothing for an unknown restaurant", async () => {
    const { service } = serviceWith(null);
    expect(await service.view(scope)).toBeNull();
    expect(await service.icon(scope, 192, false)).toBeNull();
  });
});

describe("BrandController", () => {
  const request = {
    tenantHostContext: { location: { id }, tenant: { id } }
  } as never;
  const reply = { header: vi.fn().mockReturnThis() } as never;

  it("refuses an icon size the app does not use before touching anything", async () => {
    const service = { icon: vi.fn() };
    const controller = new BrandController(service as never);
    await expect(
      controller.icon(request, reply, "4096")
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.icon(request, reply, "192", "yes")
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.icon).not.toHaveBeenCalled();
  });

  it("serves a cacheable PNG for the restaurant of the host", async () => {
    const png = Buffer.from("png");
    const service = { icon: vi.fn().mockResolvedValue(png) };
    const controller = new BrandController(service as never);
    await expect(controller.icon(request, reply, "192", "1")).resolves.toBe(
      png
    );
    expect(service.icon).toHaveBeenCalledWith(
      { locationId: id, tenantId: id },
      192,
      true
    );
    service.icon.mockResolvedValue(null);
    await expect(controller.icon(request, reply, "192")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
