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
  allOpenHazards,
  resolveHazard,
  submitHazard,
  subscribeHazards,
  CATEGORY_TONE,
  type Category,
  type Hazard,
} from "@/lib/hazards";
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
  const { purokId, snapshot, online } = useSync();
  const t = useT();

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
  const fileInput = useRef<HTMLInputElement | null>(null);

  const purokName = (id: string) =>
    snapshot?.puroks.find((p) => p.id === id)?.name ?? "";

  const refresh = useCallback(async () => {
    const [w, h, p] = await Promise.all([
      allWaterReports(),
      allOpenHazards(),
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

  /* One feed, newest first — a resident wants "what is happening", not two
     lists split by which table the row landed in. */
  const feed = [
    ...hazards.map((h) => ({ kind: "hazard" as const, ts: h.ts, hazard: h })),
    ...water.map((w) => ({ kind: "water" as const, ts: w.ts, water: w })),
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
          <p className="lbl">{t("hazard.open")}</p>

          {feed.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">{t("hazard.none")}</p>
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
  onResolve,
}: {
  hazard: Hazard;
  now: number;
  purokName: (id: string) => string;
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
      <div className="flex items-center gap-3">
        <span
          className={`mono shrink-0 text-[11px] font-bold tracking-[0.7px] ${
            tone === "alarm" ? "text-alarm" : "text-caution"
          }`}
        >
          {t(`cat.${hazard.category}`)}
        </span>
        <span className="flex-1 truncate text-[12.5px]">
          {hazard.description ?? purokName(hazard.purok_id)}
        </span>
        <span className="mono shrink-0 text-[10px] text-paper-3">
          {agoLabel(hazard.ts, now)}
        </span>
      </div>

      {hazard.photo_url && <HazardPhoto path={hazard.photo_url} />}

      {/*
        Resolve is offered to everyone (FR-7.2 allows reporter, volunteer or
        official). The client cannot prove which of those it is, so it does not
        try — RLS decides, and a resident tapping it on someone else's report
        simply gets nothing. Hiding the button by guessing the role would be a
        worse lie than showing it.
      */}
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
    </li>
  );
}
