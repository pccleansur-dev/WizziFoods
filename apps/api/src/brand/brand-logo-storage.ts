import { createClient } from "@supabase/supabase-js";

import type { BrandLogoStorage } from "./brand.service.js";

export function createBrandLogoStorage(
  supabaseUrl: string,
  supabaseSecretKey: string
): BrandLogoStorage {
  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  return {
    async download(objectPath) {
      const result = await client.storage
        .from("business-media")
        .download(objectPath);
      if (result.error || !result.data) {
        throw new Error("The logo could not be read");
      }
      return Buffer.from(await result.data.arrayBuffer());
    }
  };
}
