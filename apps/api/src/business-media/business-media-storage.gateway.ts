import { createClient } from "@supabase/supabase-js";

export interface BusinessMediaStorageGateway {
  createUploadUrl(objectPath: string): Promise<string>;
}

type StorageClient = {
  from(bucket: string): {
    createSignedUploadUrl(
      path: string,
      options: { upsert: boolean }
    ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  };
};

export class SupabaseBusinessMediaStorageGateway implements BusinessMediaStorageGateway {
  constructor(private readonly storage: StorageClient) {}

  async createUploadUrl(objectPath: string): Promise<string> {
    const result = await this.storage
      .from("business-media")
      .createSignedUploadUrl(objectPath, { upsert: false });
    if (result.error || !result.data?.signedUrl) {
      throw new Error("No se pudo preparar la carga del archivo.");
    }
    return result.data.signedUrl;
  }
}

export function createBusinessMediaStorageGateway(
  supabaseUrl: string,
  supabaseSecretKey: string
): BusinessMediaStorageGateway {
  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  return new SupabaseBusinessMediaStorageGateway(client.storage);
}
