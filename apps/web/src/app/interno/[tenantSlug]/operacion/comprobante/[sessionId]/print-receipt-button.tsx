"use client";

/** The browser prints to paper or saves a PDF; nothing leaves the device. */
export function PrintReceiptButton() {
  return (
    <button
      className="button button--primary"
      onClick={() => window.print()}
      type="button"
    >
      Imprimir o guardar como PDF
    </button>
  );
}
