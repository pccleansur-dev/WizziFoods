const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const totpPattern = /^\d{6}$/u;

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function parseCredentials(formData: FormData): {
  email: string;
  password: string;
} {
  let email: string;

  try {
    email = parseEmail(formData);
  } catch {
    throw new Error("Revisá el correo y la contraseña.");
  }
  const password = textField(formData, "password");

  if (
    email.length > 254 ||
    !emailPattern.test(email) ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new Error("Revisá el correo y la contraseña.");
  }

  return { email, password };
}

export function parseEmail(formData: FormData): string {
  const email = textField(formData, "email").trim().toLowerCase();

  if (email.length > 254 || !emailPattern.test(email)) {
    throw new Error("Ingresá un correo electrónico válido.");
  }

  return email;
}

export function parseTotpCode(formData: FormData): string {
  const code = textField(formData, "code").trim();

  if (!totpPattern.test(code)) {
    throw new Error("Ingresá el código de 6 dígitos.");
  }

  return code;
}

export function parseNewPassword(formData: FormData): string {
  const password = textField(formData, "password");
  const confirmation = textField(formData, "passwordConfirmation");

  if (password !== confirmation) {
    throw new Error("Las contraseñas no coinciden.");
  }

  if (
    password.length < 12 ||
    password.length > 128 ||
    password.trim().length < 12
  ) {
    throw new Error("Usá una contraseña de al menos 12 caracteres.");
  }

  return password;
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return "/panel";
  }

  return value;
}
