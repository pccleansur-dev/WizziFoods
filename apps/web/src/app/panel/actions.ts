"use server";

import { randomUUID } from "node:crypto";

import { readWebConfig } from "@platform/config";
import {
  evaluateCatalogImportUpload,
  parseBusinessProfileDraft,
  parseCatalogDraft,
  parseCatalogImportDraft,
  parseCatalogImportRequest,
  type CatalogImportFileKind
} from "@platform/contracts";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../auth/supabase-server";
import {
  parseProvisionedTenant,
  type TenantProvisioningActionState
} from "./tenant-provisioning-state";
import type { TenantSuspensionActionState } from "./tenant-suspension-state";
import type { BusinessProfileActionState } from "./business-profile-state";
import type { CatalogActionState } from "./catalog-action-state";
import type { CatalogAvailabilityActionState } from "./catalog-availability-state";
import type { CatalogImportActionState } from "./catalog-import-state";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function importError(
  previousState: CatalogImportActionState,
  message: string
): CatalogImportActionState {
  return { ...previousState, message, status: "error" };
}

function fileKind(file: File): CatalogImportFileKind | null {
  const extension = file.name.toLowerCase().split(".").pop();
  if (file.type === "text/csv" && extension === "csv") return "csv";
  if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    extension === "xlsx"
  ) {
    return "xlsx";
  }
  if (file.type === "application/pdf" && extension === "pdf") return "pdf";
  if (
    ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    ["jpg", "jpeg", "png", "webp"].includes(extension ?? "")
  ) {
    return "image";
  }
  return null;
}

export async function enqueueCatalogImportAction(
  previousState: CatalogImportActionState,
  formData: FormData
): Promise<CatalogImportActionState> {
  const idempotencyKey = formData.get("idempotencyKey");
  const mode = formData.get("mode");
  if (typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)) {
    return importError(
      previousState,
      "La solicitud de importación no es válida."
    );
  }
  let source: unknown;
  if (mode === "manual") {
    source = {
      kind: "manual",
      rows: [
        {
          category: String(formData.get("category") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim(),
          name: String(formData.get("name") ?? "").trim(),
          price: String(formData.get("price") ?? "").trim(),
          sector: String(formData.get("sector") ?? "").trim()
        }
      ]
    };
  } else if (mode === "file") {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return importError(previousState, "Seleccioná un archivo para importar.");
    }
    const kind = fileKind(file);
    if (!kind) {
      return importError(
        previousState,
        "El tipo o la extensión del archivo no está permitido."
      );
    }
    const decision = evaluateCatalogImportUpload({
      byteLength: file.size,
      contentType: file.type,
      fileName: file.name,
      kind
    });
    if (!decision.accepted) {
      return importError(
        previousState,
        decision.reason === "too_large"
          ? "El archivo supera el máximo de 8 MB."
          : "El archivo está vacío o no es compatible."
      );
    }
    source = {
      byteLength: file.size,
      contentBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      contentType: file.type,
      fileName: file.name,
      kind
    };
  } else {
    return importError(previousState, "Elegí carga manual o un archivo.");
  }
  const request = parseCatalogImportRequest({ idempotencyKey, source });
  if (!request) {
    return importError(previousState, "Revisá los datos de la importación.");
  }
  const auth = await tenantMutationContext();
  if (!auth)
    return importError(previousState, "La sesión venció. Volvé a ingresar.");
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/tenant/catalog-imports`, {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
        host: auth.host
      },
      method: "POST"
    });
    if (!response.ok) {
      return importError(previousState, "No pudimos encolar la importación.");
    }
    revalidatePath("/panel");
    return {
      idempotencyKey: randomUUID(),
      message:
        "Importación en cola. Actualizá en unos segundos para revisar el resultado.",
      status: "success"
    };
  } catch {
    return importError(
      previousState,
      "No pudimos comunicarnos con la plataforma."
    );
  }
}

export async function approveCatalogImportAction(
  previousState: CatalogImportActionState,
  formData: FormData
): Promise<CatalogImportActionState> {
  const importId = formData.get("importId");
  const serialized = formData.get("draft");
  let draft;
  try {
    if (typeof serialized !== "string" || serialized.length > 1_000_000) {
      throw new Error("invalid serialized import");
    }
    draft = parseCatalogImportDraft(JSON.parse(serialized));
  } catch {
    return importError(previousState, "La revisión enviada no es válida.");
  }
  if (typeof importId !== "string" || !uuidPattern.test(importId) || !draft) {
    return importError(previousState, "La revisión enviada no es válida.");
  }
  const auth = await tenantMutationContext();
  if (!auth)
    return importError(previousState, "La sesión venció. Volvé a ingresar.");
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(
      `${config.apiUrl}/v1/tenant/catalog-imports/${importId}/approve`,
      {
        body: JSON.stringify(draft),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          "content-type": "application/json",
          host: auth.host
        },
        method: "POST"
      }
    );
    if (!response.ok) {
      return importError(
        previousState,
        response.status === 400
          ? "Corregí los campos dudosos obligatorios antes de aprobar."
          : "No pudimos incorporar la importación."
      );
    }
    revalidatePath("/panel");
    return {
      idempotencyKey: randomUUID(),
      message:
        "Importación incorporada al borrador. La carta publicada no cambió.",
      status: "success"
    };
  } catch {
    return importError(
      previousState,
      "No pudimos comunicarnos con la plataforma."
    );
  }
}

export async function discardCatalogImportAction(
  previousState: CatalogImportActionState,
  formData: FormData
): Promise<CatalogImportActionState> {
  const importId = formData.get("importId");
  if (typeof importId !== "string" || !uuidPattern.test(importId)) {
    return importError(previousState, "La importación no es válida.");
  }
  const auth = await tenantMutationContext();
  if (!auth)
    return importError(previousState, "La sesión venció. Volvé a ingresar.");
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(
      `${config.apiUrl}/v1/tenant/catalog-imports/${importId}/discard`,
      {
        cache: "no-store",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          host: auth.host
        },
        method: "POST"
      }
    );
    if (!response.ok)
      return importError(previousState, "No pudimos descartar la importación.");
    revalidatePath("/panel");
    return {
      idempotencyKey: randomUUID(),
      message: "Importación descartada.",
      status: "success"
    };
  } catch {
    return importError(
      previousState,
      "No pudimos comunicarnos con la plataforma."
    );
  }
}

async function tenantMutationContext() {
  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  const host = (await headers()).get("host");
  if (
    claims.error ||
    claims.data?.claims.aal !== "aal2" ||
    session.error ||
    !accessToken ||
    !host
  ) {
    return null;
  }
  return { accessToken, host };
}

function catalogError(
  previousState: CatalogActionState,
  message: string
): CatalogActionState {
  return { ...previousState, message, status: "error" };
}

function availabilityError(
  previousState: CatalogAvailabilityActionState,
  message: string
): CatalogAvailabilityActionState {
  return { ...previousState, message, status: "error" };
}

export async function setCatalogAvailabilityAction(
  previousState: CatalogAvailabilityActionState,
  formData: FormData
): Promise<CatalogAvailabilityActionState> {
  const productId = formData.get("productId");
  const rawExpectedVersion = formData.get("expectedVersion");
  const rawAvailability = formData.get("isAvailable");
  const expectedVersion =
    rawExpectedVersion === "" ? null : Number(rawExpectedVersion);
  if (
    typeof productId !== "string" ||
    !uuidPattern.test(productId) ||
    !(
      expectedVersion === null ||
      (Number.isSafeInteger(expectedVersion) && expectedVersion > 0)
    ) ||
    (rawAvailability !== "true" && rawAvailability !== "false")
  ) {
    return availabilityError(
      previousState,
      "El cambio de disponibilidad no es válido."
    );
  }
  const auth = await tenantMutationContext();
  if (!auth) {
    return availabilityError(
      previousState,
      "La sesión venció. Volvé a ingresar."
    );
  }
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(
      `${config.apiUrl}/v1/tenant/catalog/products/${productId}/availability`,
      {
        body: JSON.stringify({
          expectedVersion,
          isAvailable: rawAvailability === "true"
        }),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          "content-type": "application/json",
          host: auth.host
        },
        method: "PATCH"
      }
    );
    if (!response.ok) {
      return availabilityError(
        previousState,
        response.status === 409
          ? "La disponibilidad cambió en otra sesión. Recargá antes de continuar."
          : "No pudimos actualizar la disponibilidad."
      );
    }
    const body = (await response.json()) as {
      data?: { isAvailable?: unknown; version?: unknown };
    };
    if (
      typeof body.data?.isAvailable !== "boolean" ||
      !Number.isSafeInteger(body.data.version) ||
      (body.data.version as number) < 1
    ) {
      return availabilityError(
        previousState,
        "No pudimos confirmar la disponibilidad."
      );
    }
    revalidatePath("/panel");
    return {
      isAvailable: body.data.isAvailable,
      message: body.data.isAvailable
        ? "El producto ya está disponible en la carta publicada."
        : "El producto ya no se ofrece en la carta publicada.",
      status: "success",
      version: body.data.version as number
    };
  } catch {
    return availabilityError(
      previousState,
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}

export async function saveCatalogAction(
  previousState: CatalogActionState,
  formData: FormData
): Promise<CatalogActionState> {
  const serialized = formData.get("catalog");
  if (typeof serialized !== "string" || serialized.length > 1_000_000) {
    return catalogError(previousState, "La carta enviada no es válida.");
  }
  let draft;
  try {
    draft = parseCatalogDraft(JSON.parse(serialized));
  } catch {
    draft = null;
  }
  if (!draft) {
    return catalogError(
      previousState,
      "Revisá categorías, sectores, productos y precios."
    );
  }
  const auth = await tenantMutationContext();
  if (!auth) {
    return catalogError(previousState, "La sesión venció. Volvé a ingresar.");
  }
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/tenant/catalog/draft`, {
      body: JSON.stringify(draft),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
        host: auth.host
      },
      method: "PUT"
    });
    if (!response.ok) {
      return catalogError(
        previousState,
        response.status === 409
          ? "La carta cambió en otra sesión. Recargá antes de continuar."
          : "No pudimos guardar la carta. Intentá nuevamente."
      );
    }
    const body = (await response.json()) as {
      data?: { revision?: unknown };
    };
    if (!Number.isSafeInteger(body.data?.revision)) {
      return catalogError(previousState, "No pudimos confirmar el guardado.");
    }
    revalidatePath("/panel");
    return {
      draftRevision: body.data!.revision as number,
      message: "Borrador guardado. La carta publicada no cambió.",
      publishedRevision: previousState.publishedRevision,
      status: "success"
    };
  } catch {
    return catalogError(
      previousState,
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}

export async function publishCatalogAction(
  previousState: CatalogActionState,
  formData: FormData
): Promise<CatalogActionState> {
  const expectedDraftRevision = Number(formData.get("draftRevision"));
  if (
    !Number.isSafeInteger(expectedDraftRevision) ||
    expectedDraftRevision < 1
  ) {
    return catalogError(
      previousState,
      "Guardá el borrador antes de publicarlo."
    );
  }
  const auth = await tenantMutationContext();
  if (!auth) {
    return catalogError(previousState, "La sesión venció. Volvé a ingresar.");
  }
  try {
    const config = readWebConfig(process.env);
    const response = await fetch(`${config.apiUrl}/v1/tenant/catalog/publish`, {
      body: JSON.stringify({ expectedDraftRevision }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        "content-type": "application/json",
        host: auth.host
      },
      method: "POST"
    });
    if (!response.ok) {
      return catalogError(
        previousState,
        response.status === 409
          ? "El borrador cambió. Guardalo otra vez antes de publicar."
          : "No pudimos publicar la carta. Intentá nuevamente."
      );
    }
    const body = (await response.json()) as {
      data?: { revision?: unknown; sourceDraftRevision?: unknown };
    };
    if (
      !Number.isSafeInteger(body.data?.revision) ||
      body.data?.sourceDraftRevision !== expectedDraftRevision
    ) {
      return catalogError(
        previousState,
        "No pudimos confirmar la publicación."
      );
    }
    revalidatePath("/panel");
    return {
      draftRevision: expectedDraftRevision,
      message: "Carta publicada. Los clientes ya ven esta versión.",
      publishedRevision: body.data!.revision as number,
      status: "success"
    };
  } catch {
    return catalogError(
      previousState,
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }
}

export async function saveBusinessProfileAction(
  previousState: BusinessProfileActionState,
  formData: FormData
): Promise<BusinessProfileActionState> {
  const nullableAsset = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value ? value : null;
  };
  const draft = parseBusinessProfileDraft({
    address: String(formData.get("address") ?? "").trim(),
    contactPhone: String(formData.get("contactPhone") ?? "").trim(),
    coverAssetId: nullableAsset("coverAssetId"),
    description: String(formData.get("description") ?? "").trim(),
    displayName: String(formData.get("displayName") ?? "").trim(),
    languages: formData.getAll("languages").map(String),
    logoAssetId: nullableAsset("logoAssetId"),
    openingHours: String(formData.get("openingHours") ?? "").trim(),
    referenceAssetIds: formData.getAll("referenceAssetIds").map(String),
    visual: {
      accentColor: String(formData.get("accentColor") ?? "").toUpperCase(),
      headingStyle: formData.get("headingStyle"),
      layout: formData.get("layout"),
      primaryColor: String(formData.get("primaryColor") ?? "").toUpperCase(),
      secondaryColor: String(formData.get("secondaryColor") ?? "").toUpperCase()
    }
  });
  if (!draft) {
    return {
      ...previousState,
      message: "Revisá los datos, colores e idiomas del negocio.",
      status: "error"
    };
  }

  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (
    claims.error ||
    claims.data?.claims.aal !== "aal2" ||
    session.error ||
    !accessToken
  ) {
    return {
      ...previousState,
      message: "La sesión venció. Volvé a ingresar.",
      status: "error"
    };
  }

  try {
    const config = readWebConfig(process.env);
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host) throw new Error("missing host");
    const response = await fetch(
      `${config.apiUrl}/v1/tenant/business-profile`,
      {
        body: JSON.stringify(draft),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          host
        },
        method: "PUT"
      }
    );
    if (!response.ok) {
      return {
        ...previousState,
        message:
          response.status === 400
            ? "Revisá los datos del perfil."
            : "No pudimos guardar el avance. Intentá nuevamente.",
        status: "error"
      };
    }
  } catch {
    return {
      ...previousState,
      message: "No pudimos comunicarnos con la plataforma. Intentá nuevamente.",
      status: "error"
    };
  }
  revalidatePath("/panel");
  return {
    message: "Guardamos el borrador. La versión publicada no cambió.",
    status: "success"
  };
}

function errorState(
  previousState: TenantProvisioningActionState,
  message: string
): TenantProvisioningActionState {
  return { ...previousState, message, status: "error" };
}

export async function createTenantAction(
  previousState: TenantProvisioningActionState,
  formData: FormData
): Promise<TenantProvisioningActionState> {
  const name = formData.get("name");
  const slug = formData.get("slug");
  const adminEmail = formData.get("adminEmail");
  if (
    typeof name !== "string" ||
    typeof slug !== "string" ||
    typeof adminEmail !== "string"
  ) {
    return errorState(previousState, "Revisá los datos del negocio.");
  }

  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.aal !== "aal2") {
    return errorState(
      previousState,
      "La sesión venció o necesita el segundo factor. Volvé a ingresar."
    );
  }
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) {
    return errorState(previousState, "La sesión venció. Volvé a ingresar.");
  }

  const config = readWebConfig(process.env);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/v1/platform/tenants`, {
      body: JSON.stringify({ adminEmail, name, slug }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": previousState.idempotencyKey
      },
      method: "POST"
    });
  } catch {
    return errorState(
      previousState,
      "No pudimos comunicarnos con la plataforma. Intentá nuevamente."
    );
  }

  if (response.status === 401 || response.status === 403) {
    return errorState(
      previousState,
      "Tu sesión no permite crear negocios. Volvé a ingresar."
    );
  }
  if (!response.ok) {
    return errorState(
      previousState,
      response.status === 400
        ? "Revisá el nombre, identificador y correo del negocio."
        : "No pudimos crear el negocio. Intentá nuevamente."
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return errorState(
      previousState,
      "El negocio fue procesado, pero no pudimos confirmar el resultado."
    );
  }
  const result = parseProvisionedTenant(responseBody);
  if (!result) {
    return errorState(
      previousState,
      "El negocio fue procesado, pero no pudimos confirmar el resultado."
    );
  }

  return {
    idempotencyKey: randomUUID(),
    message: `Creamos ${result.tenant.name}, enviamos la invitación a ${result.adminEmail} y reservamos https://${result.domain.hostname}.`,
    status: "success"
  };
}

export async function suspendTenantAction(
  previousState: TenantSuspensionActionState,
  formData: FormData
): Promise<TenantSuspensionActionState> {
  const tenantId = formData.get("tenantId");
  const mode = formData.get("mode");
  const rawReason = formData.get("reason");
  const confirmed = formData.get("confirmed");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (
    typeof tenantId !== "string" ||
    !uuidPattern.test(tenantId) ||
    (mode !== "commercial" && mode !== "security") ||
    reason.length < 3 ||
    reason.length > 500 ||
    confirmed !== "yes"
  ) {
    return {
      ...previousState,
      message: "Revisá el negocio, el tipo, el motivo y la confirmación.",
      status: "error"
    };
  }

  const supabase = await createAuthServerClient();
  const claims = await supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.aal !== "aal2") {
    return {
      ...previousState,
      message:
        "La sesión venció o necesita el segundo factor. Volvé a ingresar.",
      status: "error"
    };
  }
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (session.error || !accessToken) {
    return {
      ...previousState,
      message: "La sesión venció. Volvé a ingresar.",
      status: "error"
    };
  }

  let response: Response;
  try {
    const config = readWebConfig(process.env);
    response = await fetch(
      `${config.apiUrl}/v1/platform/tenants/${tenantId}/suspension`,
      {
        body: JSON.stringify({ mode, reason }),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-request-id": randomUUID()
        },
        method: "POST"
      }
    );
  } catch {
    return {
      ...previousState,
      message: "No pudimos comunicarnos con la plataforma. Intentá nuevamente.",
      status: "error"
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ...previousState,
      message: "Tu sesión no permite suspender negocios. Volvé a ingresar.",
      status: "error"
    };
  }
  if (!response.ok) {
    return {
      ...previousState,
      message:
        response.status === 400
          ? "El negocio o los datos de suspensión ya no son válidos."
          : "No pudimos aplicar la suspensión. Intentá nuevamente.",
      status: "error"
    };
  }

  revalidatePath("/panel");
  return {
    message:
      mode === "commercial"
        ? "Suspensión comercial iniciada: no se admitirán mesas nuevas y las abiertas podrán finalizar."
        : "Suspensión de seguridad aplicada: el acceso quedó bloqueado inmediatamente.",
    status: "success"
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/acceso");
}
