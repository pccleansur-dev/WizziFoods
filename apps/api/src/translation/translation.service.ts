import { ServiceUnavailableException } from "@nestjs/common";
import type { TranslationRequest, TranslationText } from "@platform/contracts";

import type { TranslationGateway } from "./anthropic-translation.gateway.js";

export class TranslationService {
  constructor(private readonly gateway: TranslationGateway | null) {}

  async translate(request: TranslationRequest): Promise<TranslationText[]> {
    if (!this.gateway) {
      throw new ServiceUnavailableException({
        error: {
          code: "TRANSLATION_UNAVAILABLE",
          message:
            "La traducción automática no está configurada en este entorno."
        }
      });
    }
    return this.gateway.translate(request);
  }
}
