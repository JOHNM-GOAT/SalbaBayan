"use client";

import { useEffect, useState } from "react";
import { useSync } from "./AppRuntime";
import { getMyRole, isStaffRole, onRoleChanged, type UserRole } from "@/lib/supabase";

/**
 * The role RLS grants this device, resolved once the session actually exists.
 *
 * The guard is the entire point of this hook. `getMyRole()` answers "resident"
 * when there is no session yet, and `AppRuntime` establishes the anonymous
 * session asynchronously — so a screen that asked on mount with `[]`
 * dependencies got "resident" on a cold load and never asked again. A
 * volunteer opening the app fresh during a storm saw no staff controls on
 * `/checkin` or `/headcount`, and no waiting count on their home, for the whole
 * visit. This is the same race Phase 1 already hit and documented, where the
 * advisory came back empty because the fetch beat the session.
 *
 * Returns `null` while the answer is unknown, and callers must not collapse
 * that into "resident": not-yet-known and not-staff are different answers, and
 * only one of them justifies hiding a control.
 */
export function useMyRole(): UserRole | null {
  const { userId } = useSync();
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    // No session yet: stay `null` rather than answering "resident", and wait
    // to be re-run when `userId` lands.
    if (!userId) return;

    let live = true;
    const read = () => {
      // .catch: offline, getMyRole can reject rather than resolve. An unhandled
      // rejection here would surface as a page error over a missing role.
      void getMyRole()
        .then((next) => {
          if (live) setRole(next);
        })
        .catch(() => {});
    };

    read();

    /*
     * And read it again whenever the role changes under us. Resolving once per
     * session was correct while roles could only be granted by an official on
     * another device; the demo switcher can now change this device's own role,
     * and without this every mounted screen kept the answer it fetched at mount
     * until a full reload — so a volunteer still saw "only a volunteer can mark
     * this fixed" on the screen they had just become a volunteer for.
     */
    const stop = onRoleChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, [userId]);

  return role;
}

/* Re-exported so the screens that already import it from here keep working;
   the definition sits beside UserRole in lib/supabase.ts. */
export { isStaffRole };
