"use server";

import { readWebConfig } from "@platform/config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  parseStaffLoginForm,
  staffSessionCookieName
} from "../../../staff/staff-access";
import type { StaffAccessState } from "./staff-access-state";

const invalidAccess: StaffAccessState = {
  message:
    "No pudimos verificar el usuario y PIN, o el acceso está bloqueado temporalmente.",
  status: "error"
};

export async function signInStaffAction(
  _previousState: StaffAccessState,
  formData: FormData
): Promise<StaffAccessState> {
  let parsed: ReturnType<typeof parseStaffLoginForm>;
  try {
    parsed = parseStaffLoginForm(formData);
  } catch {
    return invalidAccess;
  }

  const config = readWebConfig(process.env);
  let response: Response;
  try {
    response = await fetch(
      `${config.apiUrl}/v1/tenants/${parsed.tenantSlug}/staff-sessions`,
      {
        body: JSON.stringify(parsed.request),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
  } catch {
    return {
      message: "El acceso interno no está disponible. Intentá nuevamente.",
      status: "error"
    };
  }

  if (!response.ok) return invalidAccess;
  const payload = (await response.json()) as {
    data?: { accessToken?: unknown };
  };
  const accessToken = payload.data?.accessToken;
  if (
    typeof accessToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(accessToken)
  ) {
    return invalidAccess;
  }

  const cookieStore = await cookies();
  cookieStore.set(staffSessionCookieName(parsed.tenantSlug), accessToken, {
    httpOnly: true,
    maxAge: 8 * 60 * 60,
    path: `/interno/${parsed.tenantSlug}`,
    sameSite: "strict",
    secure: process.env.APP_ENV === "production"
  });
  redirect(`/interno/${parsed.tenantSlug}/operacion`);
}

export async function signOutStaffAction(formData: FormData): Promise<void> {
  const tenantSlug = formData.get("tenantSlug");
  if (typeof tenantSlug !== "string") redirect("/");

  let cookieName: string;
  try {
    cookieName = staffSessionCookieName(tenantSlug);
  } catch {
    redirect("/");
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(cookieName)?.value;
  if (accessToken) {
    const config = readWebConfig(process.env);
    try {
      await fetch(`${config.apiUrl}/v1/staff-sessions/current`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${accessToken}` },
        method: "DELETE"
      });
    } catch {
      // Local logout still removes the browser credential if the API is down.
    }
  }
  cookieStore.delete(cookieName);
  redirect(`/interno/${tenantSlug}`);
}
