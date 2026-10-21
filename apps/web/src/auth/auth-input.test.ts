import { describe, expect, it } from "vitest";

import {
  parseCredentials,
  parseEmail,
  parseNewPassword,
  parseTotpCode,
  safeRedirectPath
} from "./auth-input";

describe("administrative authentication input", () => {
  it("normalizes a valid email without changing the password", () => {
    const formData = new FormData();
    formData.set("email", "  ADMIN@Example.com ");
    formData.set("password", "correct horse battery staple");

    expect(parseCredentials(formData)).toEqual({
      email: "admin@example.com",
      password: "correct horse battery staple"
    });
  });

  it("rejects malformed credentials with a generic message", () => {
    const formData = new FormData();
    formData.set("email", "not-an-email");
    formData.set("password", "short");

    expect(() => parseCredentials(formData)).toThrow(
      "Revisá el correo y la contraseña."
    );
  });

  it("normalizes a valid recovery email", () => {
    const formData = new FormData();
    formData.set("email", "  OWNER@Example.com ");

    expect(parseEmail(formData)).toBe("owner@example.com");
  });

  it("accepts only a six-digit authenticator code", () => {
    const valid = new FormData();
    valid.set("code", " 123456 ");
    const invalid = new FormData();
    invalid.set("code", "12345a");

    expect(parseTotpCode(valid)).toBe("123456");
    expect(() => parseTotpCode(invalid)).toThrow(
      "Ingresá el código de 6 dígitos."
    );
  });

  it("requires a confirmed strong replacement password", () => {
    const valid = new FormData();
    valid.set("password", "a long replacement password");
    valid.set("passwordConfirmation", "a long replacement password");
    const mismatch = new FormData();
    mismatch.set("password", "a long replacement password");
    mismatch.set("passwordConfirmation", "another replacement password");

    expect(parseNewPassword(valid)).toBe("a long replacement password");
    expect(() => parseNewPassword(mismatch)).toThrow(
      "Las contraseñas no coinciden."
    );
  });

  it("allows only local redirect paths", () => {
    expect(safeRedirectPath("/panel")).toBe("/panel");
    expect(safeRedirectPath("https://attacker.example")).toBe("/panel");
    expect(safeRedirectPath("//attacker.example")).toBe("/panel");
  });
});
