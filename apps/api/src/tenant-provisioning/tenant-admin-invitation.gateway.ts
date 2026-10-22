import { createClient } from "@supabase/supabase-js";

export type TenantAdminInvitation = {
  email: string;
  redirectTo: string;
  requestId: string;
};

export interface TenantAdminInvitationGateway {
  invite(input: TenantAdminInvitation): Promise<{ userId: string }>;
}

type InvitationUser = {
  email?: string;
  id: string;
  user_metadata?: Record<string, unknown>;
};

type SupabaseAdminAuth = {
  inviteUserByEmail(
    email: string,
    options: { data: Record<string, unknown>; redirectTo: string }
  ): Promise<{
    data: { user: InvitationUser | null };
    error: unknown;
  }>;
  listUsers(parameters: { page: number; perPage: number }): Promise<{
    data: { lastPage?: number; users: InvitationUser[] };
    error: unknown;
  }>;
};

export class SupabaseTenantAdminInvitationGateway implements TenantAdminInvitationGateway {
  constructor(private readonly adminAuth: SupabaseAdminAuth) {}

  async invite(input: TenantAdminInvitation): Promise<{ userId: string }> {
    const metadata = {
      intended_role: "tenant_admin",
      tenant_provisioning_request_id: input.requestId
    };
    const invitation = await this.adminAuth.inviteUserByEmail(input.email, {
      data: metadata,
      redirectTo: input.redirectTo
    });

    if (!invitation.error && invitation.data.user) {
      return { userId: invitation.data.user.id };
    }

    for (let page = 1; page <= 100; page += 1) {
      const existingUsers = await this.adminAuth.listUsers({
        page,
        perPage: 1000
      });
      if (existingUsers.error) break;
      const matchingUser = existingUsers.data.users.find(
        (user) =>
          user.email?.toLowerCase() === input.email.toLowerCase() &&
          user.user_metadata?.tenant_provisioning_request_id === input.requestId
      );
      if (matchingUser) return { userId: matchingUser.id };
      if (page >= (existingUsers.data.lastPage ?? page)) break;
    }

    throw new Error("No se pudo enviar la invitación administrativa.");
  }
}

export function createTenantAdminInvitationGateway(
  supabaseUrl: string,
  supabaseSecretKey: string
): TenantAdminInvitationGateway {
  const client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  return new SupabaseTenantAdminInvitationGateway(client.auth.admin);
}
