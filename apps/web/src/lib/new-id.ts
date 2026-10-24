/**
 * A random UUID v4 for client-side command and line ids.
 *
 * `crypto.randomUUID` only exists in secure contexts (HTTPS or localhost), so a
 * phone or tablet opening a dev or demo server over plain HTTP on the local
 * network would crash on the first order. `getRandomValues` is available
 * everywhere and gives the same shape the contracts validate.
 */
export function newId(): string {
  const platform = globalThis.crypto;
  if (typeof platform.randomUUID === "function") return platform.randomUUID();
  const bytes = platform.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}
