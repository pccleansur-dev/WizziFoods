import { afterEach, describe, expect, it, vi } from "vitest";

import { newId } from "./new-id";

const v4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the platform UUID when the page is a secure context", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw new Error("must not be used");
      },
      randomUUID: () => "11111111-1111-4111-8111-111111111111"
    });
    expect(newId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a valid v4 UUID over plain HTTP, where randomUUID does not exist", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xff);
        return bytes;
      }
    });
    const id = newId();
    expect(id).toMatch(v4);
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("does not repeat over plain HTTP", () => {
    let counter = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        counter += 1;
        bytes.fill(counter);
        return bytes;
      }
    });
    expect(new Set(Array.from({ length: 50 }, () => newId())).size).toBe(50);
  });
});
