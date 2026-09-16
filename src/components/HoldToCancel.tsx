"use client";

import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";

/**
 * Hold-to-cancel an SOS (FR-4.5).
 *
 * The hold itself — and the re-render bug it was hardened against — lives in
 * HoldToConfirm, which the advisory screen now shares. This keeps the SOS
 * screen's import, props and wording exactly as they were.
 */
export function HoldToCancel({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return (
    <HoldToConfirm
      label={t("sos.hold_cancel")}
      holdingLabel={t("sos.cancelling")}
      tone="alarm"
      onConfirm={onCancel}
    />
  );
}
