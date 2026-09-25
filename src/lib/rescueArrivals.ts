/**
 * Which rescue requests are NEWS to this device.
 *
 * Its own module, with no imports, for the reason `hazardPermission.ts` is one:
 * it is a rule, not plumbing, and it is the kind of rule that fails in the
 * direction nobody tests. Both of its mistakes are bad in different ways —
 * sounding the alarm for calls the hall already knows about trains a volunteer
 * to ignore it, and failing to sound it for a new one is the whole feature not
 * working — and neither shows up in a screenshot.
 *
 * The state is passed in and the decision comes back, so a test can drive it
 * through a whole shift in a few lines. See scripts/rescue-arrivals-test.mjs.
 */

/** All this needs to know about a request. */
export type Arrival = { id: string; requested_by: string | null };

export type ArrivalState = {
  /** Ids this device has already been told about. Mutated in place. */
  known: Set<string>;
  /** Whether a first queue has been seen. Before that, nothing is new. */
  seeded: boolean;
};

export function newArrivalState(): ArrivalState {
  return { known: new Set(), seeded: false };
}

/**
 * The requests worth sounding an alarm for, given what this device has seen.
 *
 * Three rules, and each one is a mistake somebody would otherwise make:
 *
 *   1. The FIRST queue is silent. A volunteer opening the app to four people
 *      waiting must not be met by four alarms for calls the hall has known
 *      about for an hour. They are recorded as known and nothing sounds.
 *   2. This device's own request never sounds. A volunteer who pressed SOS
 *      themselves gets the resident's confirmation for it, not the hall's
 *      alarm for it arriving.
 *   3. A request already counted never sounds again. The queue is re-read on
 *      every realtime event, including the ones that have nothing to do with
 *      it — an acknowledgement, a rescue, a cancellation elsewhere — and a
 *      device that alarmed again on each of those would be unusable.
 *
 * The state is updated as a side effect, because "have I told them about this"
 * is exactly what it is for and splitting it would let a caller forget.
 */
export function freshArrivals(
  queue: Arrival[],
  state: ArrivalState,
  /** This device's own user id, when known. */
  mine: string | null,
): Arrival[] {
  const fresh = state.seeded
    ? queue.filter((r) => !state.known.has(r.id) && r.requested_by !== mine)
    : [];

  for (const request of queue) state.known.add(request.id);
  state.seeded = true;

  return fresh;
}
