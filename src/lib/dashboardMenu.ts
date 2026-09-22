/**
 * Whether the official dashboard's right sidebar is open. Shared state because
 * the button that opens it sits in the app header, while the sidebar belongs
 * to the dashboard page.
 */

let open = false;
const listeners = new Set<() => void>();

export const dashboardMenu = {
  subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
  get: () => open,
  set(next: boolean) {
    if (next === open) return;
    open = next;
    listeners.forEach((fn) => fn());
  },
};
