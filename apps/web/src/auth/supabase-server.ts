import { readWebAuthConfig } from "@platform/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createAuthServerClient() {
  const cookieStore = await cookies();
  const config = readWebAuthConfig(process.env);

  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              path: "/",
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production"
            });
          });
        } catch {
          // Server Components cannot write cookies. The request proxy refreshes
          // sessions before rendering; Actions and Route Handlers can write.
        }
      }
    }
  });
}
