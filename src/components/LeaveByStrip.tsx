"use client";

import { useEffect, useState } from "react";
import { useT } from "./AppRuntime";
import { formatClock, formatRemaining, signalStyle } from "@/lib/signal";

/**
 * Leave-by deadline and remaining time (FR-2.7).
 *
 * Only rendered for evacuation-level signals — a countdown attached to a
 * "prepare your go-bag" advisory would train residents to ignore it.
 *
 * The hazard-stripe banding is used here and nowhere else in the app, for the
 * same reason it is used on physical barriers: it marks the one element that
 * carries a hard deadline.
 */
export function LeaveByStrip({
  deadline,
  signalLevel,
}: {
  deadline: Date;
  signalLevel: number;
}) {
  const t = useT();
  const style = signalStyle(signalLevel);

  // Local ticker rather than a prop: this is the only element that needs
  // second-level freshness, so re-rendering the whole advisory tree once a
  // second to serve it would be wasteful.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = formatRemaining(deadline, now);

  return (
    <section
      className={`flex overflow-hidden rounded-instrument border-[1.5px] ${style.border}`}
    >
      <div
        className="w-[34px] shrink-0"
        style={{
          backgroundImage: `repeating-linear-gradient(45deg, ${style.cssVar} 0 6px, transparent 6px 12px)`,
        }}
        aria-hidden
      />
      <div className="flex flex-1 items-center justify-between bg-ink-800 px-3 py-2">
        <div>
          <p className="lbl text-[9px]">{t("ui.leave_by")}</p>
          <p className="mono mt-px text-[15px] font-bold">
            {formatClock(deadline)}
          </p>
        </div>
        <div className="text-right">
          <p className="lbl text-[9px]">{t("ui.remaining")}</p>
          {/* Past the deadline the countdown is replaced, not negated: a
              resident who is late needs to know they are late, not by how
              much. */}
          <p className={`mono mt-px text-[15px] font-bold ${style.text}`}>
            {remaining ?? t("ui.deadline_passed")}
          </p>
        </div>
      </div>
    </section>
  );
}
