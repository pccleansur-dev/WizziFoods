import type { LocalizedCatalogContent } from "@platform/contracts";

const languageNames: Record<string, string> = {
  en: "Inglés",
  es: "Español"
};

export function catalogLanguageName(language: string): string {
  return languageNames[language] ?? language;
}

export function CatalogLocalizedFields({
  content,
  languages,
  invalid,
  legend,
  onChange,
  showDescription = true
}: {
  content: LocalizedCatalogContent[];
  languages: string[];
  /** Claves `idioma:campo` con error, para marcarlos en rojo. */
  invalid?: ReadonlySet<string> | undefined;
  legend: string;
  onChange: (
    language: string,
    field: "description" | "title",
    value: string
  ) => void;
  showDescription?: boolean;
}) {
  return (
    <fieldset className="catalog-localized-fields">
      <legend>{legend}</legend>
      {languages.map((language) => {
        const localized = content.find((item) => item.language === language);
        return (
          <div className="catalog-localized-fields__language" key={language}>
            <strong>
              {catalogLanguageName(language)}
              {localized?.review === "machine" ? (
                <span className="catalog-localized-fields__draft">
                  {" "}
                  · traducción automática, sin revisar
                </span>
              ) : null}
            </strong>
            <label className="field-group">
              <span>Nombre</span>
              <input
                aria-invalid={invalid?.has(`${language}:title`) || undefined}
                lang={language}
                maxLength={120}
                onChange={(event) =>
                  onChange(language, "title", event.target.value)
                }
                placeholder={`Nombre (${catalogLanguageName(language)})`}
                required
                value={localized?.title ?? ""}
              />
            </label>
            {showDescription ? (
              <label className="field-group catalog-product__description">
                <span>Descripción</span>
                <textarea
                  aria-invalid={
                    invalid?.has(`${language}:description`) || undefined
                  }
                  lang={language}
                  maxLength={1000}
                  onChange={(event) =>
                    onChange(language, "description", event.target.value)
                  }
                  placeholder={`Descripción (${catalogLanguageName(language)})`}
                  rows={3}
                  value={localized?.description ?? ""}
                />
              </label>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
