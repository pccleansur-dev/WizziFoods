import type {
  CatalogDraft,
  LocalizedCatalogContent
} from "@platform/contracts";

function price(cents: number) {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    maximumFractionDigits: 2,
    style: "currency"
  }).format(cents / 100);
}

function thumbnailFor(
  assetId: string | null,
  previews: Record<string, string>
): string | undefined {
  const url = assetId ? previews[assetId] : undefined;
  return url?.startsWith("blob:") ? url : undefined;
}

export function CatalogPreview({
  draft,
  language,
  previews = {},
  publishedRevision
}: {
  draft: CatalogDraft;
  language: string;
  /** Miniaturas locales (blob:) por id de imagen, de las subidas de esta sesión. */
  previews?: Record<string, string> | undefined;
  publishedRevision: number | null;
}) {
  const localized = (item: {
    content: LocalizedCatalogContent[];
  }): LocalizedCatalogContent | undefined =>
    item.content.find((content) => content.language === language) ??
    item.content[0];
  return (
    <aside className="catalog-preview" aria-label="Vista previa de la carta">
      <div className="catalog-preview__heading">
        <div>
          <p className="eyebrow">Vista previa de la carta</p>
          <h3>Así la verá el cliente</h3>
        </div>
        <span className="catalog-status catalog-status--draft">Borrador</span>
      </div>
      {draft.categories.length === 0 ? (
        <div className="catalog-empty-preview">
          <span aria-hidden="true">◌</span>
          <strong>La carta todavía está vacía</strong>
          <p>Agregá una categoría, un sector y el primer producto.</p>
        </div>
      ) : (
        <div className="catalog-menu-preview">
          {draft.categories.map((category) => {
            const categoryContent = localized(category);
            const products = draft.products.filter(
              ({ categoryId }) => categoryId === category.id
            );
            return (
              <section key={category.id} className="catalog-menu-section">
                <div>
                  <h4>{categoryContent?.title || "Categoría sin nombre"}</h4>
                  {categoryContent?.description ? (
                    <p>{categoryContent.description}</p>
                  ) : null}
                </div>
                {products.length === 0 ? (
                  <p className="catalog-menu-section__empty">
                    Sin productos todavía
                  </p>
                ) : (
                  products.map((product) => {
                    const content = localized(product);
                    return (
                      <article key={product.id} className="catalog-menu-item">
                        {thumbnailFor(product.imageAssetId, previews) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:)
                          <img
                            alt=""
                            className="catalog-menu-item__thumb"
                            src={thumbnailFor(product.imageAssetId, previews)}
                          />
                        ) : null}
                        <div>
                          <h5>{content?.title || "Producto sin nombre"}</h5>
                          {content?.description ? (
                            <p>{content.description}</p>
                          ) : null}
                        </div>
                        <div className="catalog-menu-item__price">
                          <strong>{price(product.priceCents)}</strong>
                          {product.variants.map((variant) => (
                            <span key={variant.id}>
                              {localized(variant)?.title}: +
                              {price(variant.priceDeltaCents)}
                            </span>
                          ))}
                        </div>
                      </article>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="catalog-preview__published">
        <span>Versión visible ahora</span>
        <strong>
          {publishedRevision === null
            ? "Todavía no publicada"
            : `Publicada · versión ${publishedRevision}`}
        </strong>
      </div>
    </aside>
  );
}
