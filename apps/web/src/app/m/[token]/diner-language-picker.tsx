"use client";

import { useSyncExternalStore } from "react";

const storageKey = "diner-language";

function subscribe(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener("diner-language", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("diner-language", listener);
  };
}

function stored(): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/**
 * The language the diner reads the menu in: what they picked, else the one of their phone,
 * else the business's own. Only the choice is remembered, on this device.
 */
export function useDinerLanguage(available: string[]): {
  choose(language: string): void;
  language: string | null;
} {
  const saved = useSyncExternalStore(subscribe, stored, () => null);
  const phone = useSyncExternalStore(
    () => () => undefined,
    () => navigator.language,
    () => ""
  );
  const wanted = [saved, phone, phone.split("-")[0]].find(
    (candidate): candidate is string =>
      Boolean(candidate) &&
      available.some(
        (language) =>
          language === candidate || language === candidate?.split("-")[0]
      )
  );
  const language = wanted
    ? (available.find((item) => item === wanted) ??
      available.find((item) => item === wanted.split("-")[0]) ??
      null)
    : null;
  return {
    choose(next) {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // Private mode: the choice lasts until the page closes.
      }
      window.dispatchEvent(new Event("diner-language"));
    },
    language
  };
}

const names: Record<string, string> = {
  en: "English",
  es: "Español",
  pt: "Português"
};

export function DinerLanguagePicker({
  available,
  choose,
  language
}: {
  available: string[];
  choose(language: string): void;
  language: string | null;
}) {
  if (available.length < 2) return null;
  return (
    <div className="diner-language">
      <label htmlFor="diner-language-select">Idioma de la carta</label>
      <select
        id="diner-language-select"
        onChange={(event) => choose(event.target.value)}
        value={language ?? available[0]}
      >
        {available.map((item) => (
          <option key={item} lang={item} value={item}>
            {names[item] ?? item}
          </option>
        ))}
      </select>
    </div>
  );
}
