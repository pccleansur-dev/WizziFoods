import type { ApiRuntimeConfig } from "@platform/config";

import {
  FakeGoogleOidcGateway,
  HttpGoogleOidcGateway,
  type GoogleOidcGateway
} from "./google-oidc.gateway.js";

export type DinerIdentityRuntime = {
  available: boolean;
  fake: boolean;
  google: GoogleOidcGateway | null;
  scheme: "http" | "https";
  stateSecret: string;
  subPepper: string;
};

/** Builds the Google side the configuration asks for; nothing exists when it is off. */
export function createDinerIdentityRuntime(
  config: ApiRuntimeConfig
): DinerIdentityRuntime {
  const settings = config.dinerAuth ?? { mode: "off" as const };
  const scheme = config.environment === "production" ? "https" : "http";
  if (settings.mode === "off") {
    return {
      available: false,
      fake: false,
      google: null,
      scheme,
      stateSecret: "",
      subPepper: ""
    };
  }
  return {
    available: true,
    fake: settings.mode === "fake",
    google:
      settings.mode === "fake"
        ? new FakeGoogleOidcGateway(settings.redirectUri)
        : new HttpGoogleOidcGateway({
            clientId: settings.clientId,
            clientSecret: settings.clientSecret,
            redirectUri: settings.redirectUri
          }),
    scheme,
    stateSecret: settings.stateSecret,
    subPepper: settings.subPepper
  };
}
