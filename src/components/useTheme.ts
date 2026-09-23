"use client";

import { useSyncExternalStore } from "react";
import { themePref } from "@/lib/prefs";

export type Theme = "light" | "dark";

/**
 * Light or dark, chosen by the person and remembered on the phone.
 *
 * The white palette is the default, as the team decided. Dark is offered
 * because of the case the tokens file already names: this app is read outdoors
 * at night, in a storm, on a phone whose battery may be the last one in the
 * house — and a white screen wrecks dark adaptation and costs more power on an
 * OLED panel.
 *
 * The attribute is set on <html> by the inline script in the layout before the
 * first paint, so nothing flashes white on a dark phone; this hook only keeps
 * it in step afterwards.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const stored = useSyncExternalStore(
    themePref.subscribe,
    () => themePref.get(),
    () => null,
  );
  const theme: Theme = stored === "dark" ? "dark" : "light";

  return {
    theme,
    setTheme(next) {
      themePref.set(next);
      // The DOM is the source of truth for CSS; set it here rather than in an
      // effect so the repaint happens on the tap, not a render later.
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
    },
  };
}
