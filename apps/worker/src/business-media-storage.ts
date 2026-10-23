import { createClient } from "@supabase/supabase-js";

import type { BusinessMediaJobStorage } from "./business-media-job.js";

type BusinessMediaContentType = "image/jpeg" | "image/png" | "image/webp";

type StorageResult<T> = Promise<{ data: T | null; error: unknown }>;

type StorageClient = {
  from(bucket: string): {
    download(path: string): StorageResult<Blob>;
    upload(
      path: string,
      bytes: Uint8Array,
      options: {
        cacheControl: string;
        contentType: BusinessMediaContentType;
        upsert: boolean;
      }
    ): StorageResult<unknown>;
  };
};

export function createBusinessMediaStorage(
  storage: StorageClient
): BusinessMediaJobStorage {
  return {
    async download(objectPath) {
      const result = await storage.from("business-media").download(objectPath);
      if (result.error || !result.data) {
        throw new Error("Business media download failed");
      }
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async replace(objectPath, bytes, contentType) {
      const result = await storage
        .from("business-media")
        .upload(objectPath, bytes, {
          cacheControl: "31536000",
          contentType,
          upsert: true
        });
      if (result.error || !result.data) {
        throw new Error("Business media replacement failed");
      }
    }
  };
}

export function createSupabaseBusinessMediaStorage(
  supabaseUrl: string,
  supabaseSecretKey: string
): BusinessMediaJobStorage {
  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  return createBusinessMediaStorage(client.storage);
}
