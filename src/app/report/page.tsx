"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { onQueueChanged } from "@/lib/offlineQueue";
import { DepthPicker } from "@/components/DepthPicker";
import { CategoryPicker } from "@/components/CategoryPicker";
import { HazardPhoto } from "@/components/HazardPhoto";
import {
  agoLabel,
  DEPTH_TONE,
  allWaterReports,
  submitWaterReport,
  subscribeWaterReports,
  type Depth,
  type WaterReport,
} from "@/lib/water";
import {
  allHazards,
  canResolveHazard,
  resolveHazard,
  submitHazard,
  subscribeHazards,
  CATEGORY_TONE,
  type Category,
  type Hazard,
} from "@/lib/hazards";
import { useMyRole } from "@/components/useMyRole";
import { focusHazard } from "@/lib/hazardFocus";
import { pendingPhotoCount } from "@/lib/photoQueue";

/**
 * Reporting (PRD §7.6 water, §7.7 hazards).
 *
 * One screen, because a resident who has just seen something wrong does not
 * know or care whether the app files it as a "water report" or a "hazard
 * report". They pick what they saw; the form follows. Flooding routes to the
 * body-referenced depth scale, everything else to a description and an
 * optional photo.
 */
export default function ReportPage() {
  const { purokId, snapshot, online, userId } = useSync();
  const t = useT();
  const role = useMyRole();

  const [category, setCategory] = useState<Category | null>(null);
  const [depth, setDepth] = useState<Depth | null>(null);
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<"sent" | "queued" | null>(null);
  const [photosPending, setPhotosPending] = useState(0);

  const [water, setWater] = useState<WaterReport[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [now, setNow] = useState(() => Date.now());
  /** Which half of the feed is showing. Unresolved is the working list. */
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const purokName = (id: string) =>
    snapshot?.puroks.find((p) => p.id === id)?.name ?? "";

  const refresh = useCallback(async () => {
    const [w, h, p] = await Promise.all([
      allWaterReports(),
      allHazards(),
      pendingPhotoCount(),
    ]);
    setWater(w);
    setHazards(h);
    setPhotosPending(p);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const stopWater = subscribeWaterReports(() => void refresh());
    const stopHazards = subscribeHazards(() => void refresh());
    const stopQueue = onQueueChanged(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stopWater();
      stopHazards();
      stopQueue();
      window.clearInterval(tick);
    };
  }, [refresh]);

  const isFlood = category === "flooding";
  const canSend = isFlood ? depth !== null : category !== null;

  async function onSubmit() {
    if (!purokId || !category) return;

    if (isFlood) {
      if (!depth) return;
      await submitWaterReport({ purokId, depth, locationLabel: label });
    } else {
      await submitHazard({ purokId, category, description: detail, photo });
    }

    // The write is durable, not delivered — worded by connectivity rather than
    // by a delivery flag that does not exist.
    setOutcome(online ? "sent" : "queued");
    setCategory(null);
    setDepth(null);
    setLabel("");
    setDetail("");
    setPhoto(null);
    if (fileInput.current) fileInput.current.value = "";
    void refresh();
  }

  const openCount = hazards.filter((h) => h.status === "open").length;
  const resolvedCount = hazards.filter((h) => h.status === "resolved").length;

  /*
   * One feed, newest first — a resident wants "what is happening", not two
   * lists split by which table the row landed in.
   *
   * Water reports appear under Unresolved only, and are deliberately not given
   * a Resolved counterpart. A depth reading is an observation of how things
   * were at a moment, not a job someone can finish; "resolved knee-deep water"
   * would be a claim nobody made.
   */
  const feed = [
    ...hazards
      .filter((h) => h.status === filter)
      .map((h) => ({ kind: "hazard" as const, ts: h.ts, hazard: h })),
    ...(filter === "open"
      ? water.map((w) => ({ kind: "water" as const, ts: w.ts, water: w }))
      : []),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("report.title")}
        </h1>
        <span className="mono text-[10px] tracking-[0.7px] text-paper-3">
          {purokId ? purokName(purokId).toUpperCase() : ""}
        </span>
      </div>

      <main className="flex flex-1 flex-col gap-4 p-3.5">
        <section>
          <p className="lbl mb-2">{t("report.what")}</p>
          <CategoryPicker value={category} onChange={setCategory} />
        </section>

        {isFlood && (
          <>
            <section>
              <p className="lbl mb-2">{t("water.how_high")}</p>
              <DepthPicker value={depth} onChange={setDepth} />
            </section>

            <section>
              <label htmlFor="where" className="lbl mb-2 block">
                {t("water.where")}
              </label>
              <input
                id="where"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t("water.where_hint")}
                className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
              />
            </section>
          </>
        )}

        {category && !isFlood && (
          <>
            <section>
              <label htmlFor="detail" className="lbl mb-2 block">
                {t("hazard.detail")}
              </label>
              <textarea
                id="detail"
                rows={2}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder={t("hazard.detail_hint")}
                className="w-full resize-none rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
              />
            </section>

            <section>
              <p className="lbl mb-2">{t("hazard.photo")}</p>
              <div className="flex items-center gap-2.5">
                {photo ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPhoto(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                    aria-label={t("hazard.remove_photo")}
                    className="relative size-[68px] overflow-hidden rounded-instrument border-[1.5px] border-line-soft"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(photo)}
                      alt=""
                      className="size-full object-cover"
                    />
                    <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-[2px] bg-ink-900/85 text-[13px] leading-none text-paper">
                      ×
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex size-[68px] items-center justify-center rounded-instrument border-[1.5px] border-dashed border-line text-paper-3"
                    aria-label={t("hazard.add_photo")}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
                      <circle cx="12" cy="13" r="3.2" />
                    </svg>
                  </button>
                )}

                {/*
                  The promise the photo fail-safe makes, said before it is
                  needed: the picture is kept on the phone and uploaded later,
                  so nobody stands in the rain waiting for an upload bar.
                */}
                <p className="mono flex-1 text-[9.5px] leading-relaxed tracking-[0.6px] text-paper-3">
                  {t("hazard.photo_queued")}
                </p>
              </div>

              {/* `capture` opens the camera directly on a phone rather than a
                  file browser, which is the only sensible source here. */}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                className="hidden"
              />
            </section>
          </>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          className="tap flex items-center justify-center rounded-instrument bg-hv py-3 font-display text-[15.5px] font-extrabold tracking-[0.3px] text-hv-ink disabled:opacity-35"
        >
          {t("hazard.submit")}
        </button>

        <p className="mono -mt-2 text-center text-[9.5px] tracking-[0.7px] text-paper-3">
          {!category
            ? t("hazard.pick")
            : isFlood && !depth
              ? t("water.pick_depth")
              : t("water.visible")}
        </p>

        {outcome && (
          <p
            className={`rounded-instrument border-[1.5px] px-3 py-2.5 text-[12.5px] leading-snug font-semibold ${
              outcome === "sent" ? "border-clear text-clear" : "border-caution text-caution"
            }`}
            role="status"
          >
            {outcome === "sent" ? t("hazard.sent") : t("hazard.queued")}
          </p>
        )}

        {photosPending > 0 && (
          <p className="mono text-[10px] tracking-[0.6px] text-caution">
            {t("hazard.photo_pending", { n: photosPending })}
          </p>
        )}

        <section className="flex flex-1 flex-col gap-2">
          {/*
            Unresolved / Resolved.

            Both counts are always shown, including the zeroes, because the
            question the filter answers is "has anyone dealt with this yet" and
            a tab that disappears when empty cannot answer it. Unresolved leads
            and is the default: it is what a volunteer opens this screen to
            work through.
          */}
          <div className="flex gap-1.5" role="tablist" aria-label={t("hazard.open")}>
            {(["open", "resolved"] as const).map((value) => {
              const isActive = filter === value;
              const count = value === "open" ? openCount : resolvedCount;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setFilter(value)}
                  className={`tap flex flex-1 items-center justify-center gap-2 rounded-instrument border-[1.5px] px-3 text-[11px] font-bold tracking-[0.5px] ${
                    isActive
                      ? "border-hv bg-hv text-hv-ink"
                      : "border-line-soft bg-ink-800 text-paper-2"
                  }`}
                >
                  {value === "open" ? t("hazard.unresolved") : t("hazard.resolved")}
                  <span className="mono text-[11px] font-bold opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {feed.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">
              {filter === "open" ? t("hazard.none") : t("hazard.none_resolved")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {feed.map((entry) =>
                entry.kind === "water" ? (
                  <li
                    key={entry.water.id}
                    className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5"
                  >
                    <span
                      className={`mono shrink-0 text-[11px] font-bold tracking-[0.7px] ${DEPTH_TONE[entry.water.level_category]}`}
                    >
                      {t(`water.${entry.water.level_category}`)}
                    </span>
                    <span className="flex-1 truncate text-[12.5px]">
                      {entry.water.location_label ?? purokName(entry.water.purok_id)}
                    </span>
                    <span className="mono shrink-0 text-[10px] text-paper-3">
                      {agoLabel(entry.water.ts, now)}
                    </span>
                  </li>
                ) : (
                  <HazardRow
                    key={entry.hazard.id}
                    hazard={entry.hazard}
                    now={now}
                    purokName={purokName}
                    canFix={canResolveHazard(entry.hazard, userId ?? null, role)}
                    onResolve={async () => {
                      await resolveHazard(entry.hazard.id);
                      void refresh();
                    }}
                  />
                ),
              )}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function HazardRow({
  hazard,
  now,
  purokName,
  canFix,
  onResolve,
}: {
  hazard: Hazard;
  now: number;
  purokName: (id: string) => string;
  canFix: boolean;
  onResolve: () => void;
}) {
  const t = useT();
  const tone = CATEGORY_TONE[hazard.category];

  return (
    <li
      className={`rounded-instrument border-l-4 bg-ink-800 px-3 py-2.5 ${
        tone === "alarm" ? "border-alarm" : "border-caution"
      }`}
    >
      {/*
        The row itself opens the hazard map on this report. It is a button
        around the summary only, NOT around the whole card — "Mark as fixed"
        lives below it, and a button inside a button is invalid markup that
        browsers resolve by guessing.
      */}
      <button
        type="button"
        onClick={() => focusHazard(hazard.id)}
        className="w-full text-left"
        aria-label={`${t(`cat.${hazard.category}`)} — ${t("hz.title")}`}
      >
      <div className="flex items-center gap-2.5">
        <span
          className={`mono shrink-0 text-[11px] font-bold tracking-[0.7px] ${
            tone === "alarm" ? "text-alarm" : "text-caution"
          }`}
        >
          {t(`cat.${hazard.category}`)}
        </span>

        {/*
          The state, stated.

          This row used to carry no status at all and a control labelled
          "Resolved" / "Ayos na" — so every new report appeared with a green
          tick reading RESOLVED underneath it, and the feed looked like it was
          closing reports the instant they were filed. The row was `status:
          'open'` in the database the whole time; the screen was just describing
          a state where it should have been naming an action. The chip says what
          is true, and the button below now says what tapping it does.
        */}
        {hazard.status === "resolved" ? (
          <span className="mono shrink-0 rounded-[3px] border border-clear px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.7px] text-clear">
            {t("hazard.resolved")}
          </span>
        ) : (
          <span className="mono shrink-0 rounded-[3px] border border-caution px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.7px] text-caution">
            {t("hazard.unresolved")}
          </span>
        )}

        {/*
          The row reads as fixed because of a write still sitting in the queue,
          not because the barangay has been told. Saying so is the same rule the
          sync strip follows: never let a local intention look like a fact
          somebody else can see.
        */}
        {hazard.pending && (
          <span className="mono shrink-0 text-[8.5px] font-bold tracking-[0.6px] text-caution">
            {t("hazard.pending")}
          </span>
        )}

        <span className="mono ml-auto shrink-0 text-[10px] text-paper-3">
          {agoLabel(hazard.ts, now)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px]">
          {hazard.description ?? purokName(hazard.purok_id)}
        </p>
        {/* The affordance. Without it the row looks like a label, and nobody
            discovers that tapping it shows where the thing actually is. */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d="M12 22s7-7.58 7-13a7 7 0 0 0-14 0c0 5.42 7 13 7 13z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      </div>
      </button>

      {hazard.photo_url && <HazardPhoto path={hazard.photo_url} />}

      {/*
        Offered only to someone it can work for — see `canResolveHazard`. RLS is
        still the decision; this just stops the app from presenting an action
        that will silently do nothing. An already-resolved row offers nothing at
        all: there is no un-resolve, and a second "Mark as fixed" on something
        already fixed would be a control with no effect to find out about.
      */}
      {hazard.status === "resolved" ? null : canFix ? (
        <button
          type="button"
          onClick={onResolve}
          className="mono mt-2 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.7px] text-clear"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {t("hazard.resolve")}
        </button>
      ) : (
        <p className="mono mt-2 text-[9.5px] leading-relaxed tracking-[0.5px] text-paper-3">
          {t("hz.only_volunteer")}
        </p>
      )}
    </li>
  );
}
