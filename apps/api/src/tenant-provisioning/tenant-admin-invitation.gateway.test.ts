import { describe, expect, it } from "vitest";

import { SupabaseTenantAdminInvitationGateway } from "./tenant-admin-invitation.gateway.js";

describe("Supabase tenant administrator invitations", () => {
  const input = {
    email: "owner@example.com",
    redirectTo: "https://app.example.test/auth/callback",
    requestId: "70000000-0000-4000-8000-000000000007"
  };

  it("returns the invited identity without exposing an action link", async () => {
    const gateway = new SupabaseTenantAdminInvitationGateway({
      inviteUserByEmail: async () => ({
        data: { user: { id: "71000000-0000-4000-8000-000000000071" } },
        error: null
      }),
      listUsers: async () => ({ data: { users: [] }, error: null })
    });

    await expect(gateway.invite(input)).resolves.toEqual({
      userId: "71000000-0000-4000-8000-000000000071"
    });
  });

  it("recovers the same invited identity after a retry", async () => {
    const gateway = new SupabaseTenantAdminInvitationGateway({
      inviteUserByEmail: async () => ({
        data: { user: null },
        error: { message: "already invited" }
      }),
      listUsers: async () => ({
        data: {
          users: [
            {
              email: input.email,
              id: "71000000-0000-4000-8000-000000000071",
              user_metadata: {
                tenant_provisioning_request_id: input.requestId
              }
            }
          ]
        },
        error: null
      })
    });

    await expect(gateway.invite(input)).resolves.toEqual({
      userId: "71000000-0000-4000-8000-000000000071"
    });
  });

  it("does not attach an existing user from another provisioning request", async () => {
    const gateway = new SupabaseTenantAdminInvitationGateway({
      inviteUserByEmail: async () => ({
        data: { user: null },
        error: { message: "already registered" }
      }),
      listUsers: async () => ({
        data: {
          users: [
            {
              email: input.email,
              id: "71000000-0000-4000-8000-000000000071",
              user_metadata: {
                tenant_provisioning_request_id: "another-request"
              }
            }
          ]
        },
        error: null
      })
    });

    await expect(gateway.invite(input)).rejects.toThrow(
      "No se pudo enviar la invitación administrativa."
    );
  });
});
