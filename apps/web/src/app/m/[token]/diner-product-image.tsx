/**
 * Reserved space for a product photo. Until the diner side has a public source
 * for catalog images the slot shows a neutral tile with the product's initial;
 * passing `src` fills it with the photo without changing the layout.
 */
export function DinerProductImage({
  size,
  src = null,
  title
}: {
  size: "card" | "hero";
  src?: string | null;
  title: string;
}) {
  return (
    <span aria-hidden="true" className={`diner-image diner-image--${size}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- slot sized by CSS
        <img alt="" loading="lazy" src={src} />
      ) : (
        <span>{title.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}
