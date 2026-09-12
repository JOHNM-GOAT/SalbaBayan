/**
 * "Show me this report on the map."
 *
 * The hazard map is mounted once, in the layout, so that there is one MapLibre
 * instance rather than one per route. That is the right shape, but it means the
 * report feed cannot simply render the map itself — it has to ask the sheet,
 * which is neither its parent nor its child.
 *
 * A tiny emitter rather than a context or a router param, for two reasons. It
 * matches how the rest of this app already talks across that boundary
 * (`onQueueChanged`, `subscribeHazards`, `onRoleChanged`), and it keeps the
 * request out of the URL — a hazard id in the address bar would be shared,
 * bookmarked and pasted into group chats, and it would outlive the report it
 * points at.
 */

type Listener = (hazardId: string) => void;

const listeners = new Set<Listener>();

/** Open the hazard map on this report. */
export function focusHazard(hazardId: string): void {
  // Copied before notifying: a listener may unsubscribe in response.
  for (const listener of [...listeners]) listener(hazardId);
}

export function onHazardFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
