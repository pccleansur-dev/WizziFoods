import {
  evaluateBusinessMediaUpload,
  type BusinessMediaKind
} from "@platform/contracts";

import { parseBusinessMediaStatus } from "./business-media";

type UploadDependencies = {
  fetcher?: typeof fetch;
  onStatus?: (status: "processing") => void;
  wait?: (milliseconds: number) => Promise<void>;
};

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function uploadBusinessMedia(
  file: File,
  kind: BusinessMediaKind,
  dependencies: UploadDependencies = {}
): Promise<string> {
  const decision = evaluateBusinessMediaUpload({
    byteLength: file.size,
    contentType: file.type,
    currentTenantBytes: 0
  });
  if (!decision.accepted) {
    throw new Error("Usá una imagen JPG, PNG o WebP de hasta 12 MB.");
  }

  const fetcher = dependencies.fetcher ?? fetch;
  const formData = new FormData();
  formData.set("file", file);
  formData.set("kind", kind);
  const uploadResponse = await fetcher("/api/business-media", {
    body: formData,
    method: "POST"
  });
  if (!uploadResponse.ok) {
    throw new Error("No pudimos cargar la imagen. Intentá nuevamente.");
  }
  const queued = parseBusinessMediaStatus(await uploadResponse.json());
  if (queued.kind !== kind || queued.status !== "processing") {
    throw new Error("No pudimos confirmar la carga de la imagen.");
  }
  dependencies.onStatus?.("processing");

  const wait = dependencies.wait ?? defaultWait;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(1_000);
    const statusResponse = await fetcher(
      `/api/business-media/${queued.assetId}`,
      { cache: "no-store", method: "GET" }
    );
    if (!statusResponse.ok) {
      throw new Error("No pudimos consultar la imagen.");
    }
    const current = parseBusinessMediaStatus(await statusResponse.json());
    if (current.assetId !== queued.assetId || current.kind !== kind) {
      throw new Error("No pudimos confirmar la imagen procesada.");
    }
    if (current.status === "ready") return current.assetId;
    if (current.status === "failed") {
      throw new Error("La imagen no pudo validarse.");
    }
  }
  throw new Error(
    "La imagen sigue procesándose. Volvé a intentar en un momento."
  );
}
