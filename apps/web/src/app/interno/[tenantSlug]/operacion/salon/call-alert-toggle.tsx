"use client";

/** Mutes or restores the sound and vibration for new calls on this device. */
export function CallAlertToggle({
  muted,
  onChange
}: {
  muted: boolean;
  onChange(muted: boolean): void;
}) {
  return (
    <button
      aria-pressed={!muted}
      className="button button--secondary waiter-alert-toggle"
      onClick={() => onChange(!muted)}
      type="button"
    >
      {muted
        ? "Aviso de llamados: silenciado en este dispositivo"
        : "Aviso de llamados: con sonido y vibración"}
    </button>
  );
}
