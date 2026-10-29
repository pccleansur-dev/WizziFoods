import { createClient } from "@supabase/supabase-js";

import type { CatalogImageStorage } from "./catalog-image.service.js";

export function createCatalogImageStorage(
  supabaseUrl: string,
  supabaseSecretKey: string
): CatalogImageStorage {
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
        throw new Error("The product photo could not be read");
      }
      return Buffer.from(await result.data.arrayBuffer());
    }
  };
}
