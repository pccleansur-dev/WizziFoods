"use server";

import { redirect } from "next/navigation";

import { createAuthServerClient } from "../../auth/supabase-server";

export async function signOutAction(): Promise<void> {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/acceso");
}
