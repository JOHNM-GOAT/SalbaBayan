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

/**
 * Which report to show. Hazards and flood readings are separate tables with
 * separate pins, so the kind travels with the id rather than being guessed at
 * the far end.
 */
export type FocusRequest = { kind: "hazard" | "water"; id: string };

type Listener = (request: FocusRequest) => void;

const listeners = new Set<Listener>();

/** Open the hazard map on this hazard report. */
export function focusHazard(hazardId: string): void {
  emit({ kind: "hazard", id: hazardId });
}

/** Open the hazard map on this flood reading. */
export function focusWater(reportId: string): void {
  emit({ kind: "water", id: reportId });
}

function emit(request: FocusRequest): void {
  // Copied before notifying: a listener may unsubscribe in response.
  for (const listener of [...listeners]) listener(request);
}

export function onReportFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
