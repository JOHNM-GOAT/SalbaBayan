"use client";

import { useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { useBulletin } from "@/components/useBulletin";
import {
  bulletinToAdvisory,
  differsFromAdvisory,
  valuesFromBarangay,
  type AdvisoryValues,
  type BulletinSignal,
} from "@/lib/advisoryForm";
import { BULLETIN_URL, signalHere, type Bulletin } from "@/lib/pagasa";
import { signalStyle } from "@/lib/signal";
import { agoLabel } from "@/lib/water";

/**
 * PAGASA's tropical cyclone bulletin, on the official dashboard (officials
 * only — no resident screen renders this).
 *
 * It is a reading aid, not an authority. The card states what was read, how
 * long ago, and links to the bulletin itself; the button fills the advisory
 * form and stops there. Every number a resident sees still passes through an
 * official who read it and held the confirm button.
 *
 * The signal shown is the one for THIS barangay, worked out from the area lists
 * (lib/pagasa.ts). When the bulletin names only part of the province, the card
 * says so instead of offering a number — see `matchArea`.
 */
export function BulletinCard({ onUse }: { onUse: (values: AdvisoryValues, note: string) => void }) {
  const { snapshot } = useSync();
  const t = useT();
  const { reading, loading, reload } = useBulletin();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  if (!snapshot) return null;
  const barangay = snapshot.barangay;

  const head = (
    <div className="flex items-center gap-2">
      <span className="lbl flex-1">{t("dash.bulletin")}</span>
      {reading && (
        <span className="mono text-[9px] tracking-[0.6px] text-paper-3">
          {t("dash.bulletin_read")} {agoLabel(reading.fetchedAt, now)}
        </span>
      )}
      <button
        type="button"
        onClick={reload}
        aria-label={t("dash.bulletin_refresh")}
        title={t("dash.bulletin_refresh")}
        className="tap-none px-0.5 text-paper-3 hover:text-paper"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={loading ? "animate-spin" : undefined}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );

  const link = (
    <a
      href={BULLETIN_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="mono text-[9.5px] font-bold tracking-[0.8px] text-hv underline-offset-2 hover:underline"
    >
      {t("dash.bulletin_open")} ↗
    </a>
  );

  const shell = (children: React.ReactNode) => (
    <section className="grid gap-2 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-2.5 py-2">
      {head}
      {children}
      {link}
    </section>
  );

  /* Nothing read yet on this device, and nothing stored from before. */
  if (!reading) {
    return shell(
      <p className="mono text-[10.5px] leading-relaxed text-paper-3">
        {loading ? "…" : t("dash.bulletin_offline")}
      </p>,
    );
  }

  if (reading.state === "none") {
    return shell(
      <p className="text-[11.5px] leading-snug text-paper-2">{t("dash.bulletin_none")}</p>,
    );
  }

  if (reading.state !== "active") {
    /* Fetched and not understood, or not fetched at all. Both say plainly that
       this card knows nothing, rather than implying calm weather. */
    return shell(
      <p className="text-[11.5px] leading-snug text-caution">
        {reading.state === "unavailable" ? t("dash.bulletin_offline") : t("dash.bulletin_unread")}
      </p>,
    );
  }

  const bulletin = reading.bulletin;
  const here = signalHere(bulletin, {
    province: barangay.province,
    municipality: barangay.municipality,
  });
  const current = valuesFromBarangay(barangay);
  const style = signalStyle(here?.level ?? 0);
  /* "Certain" is the whole province listed, or this municipality named inside
     a partial area; anything else is a sentence about somewhere nearby. */
  const certain = here?.match === "province" || here?.match === "municipality";
  const signal: BulletinSignal = here ? { level: here.level, certain } : null;
  const changes = differsFromAdvisory(bulletin, signal, current);

  return shell(
    <>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 font-display text-[15px] leading-tight font-extrabold">
          {bulletin.stormName ?? bulletin.category ?? "—"}
          {bulletin.internationalName && (
            <span className="mono ml-1.5 text-[9.5px] font-bold text-paper-3">
              {bulletin.internationalName}
            </span>
          )}
        </p>
        {bulletin.bulletinNo != null && (
          <span className="mono shrink-0 text-[10px] font-bold text-paper-2">
            #{bulletin.bulletinNo}
          </span>
        )}
      </div>

      {bulletin.category && bulletin.stormName && (
        <p className="mono text-[9.5px] tracking-[0.6px] text-paper-3">
          {bulletin.category.toUpperCase()}
        </p>
      )}

      {/* The signal for this barangay — the one number an official is here for. */}
      {here ? (
        <div className="flex items-center gap-2.5">
          <span
            className={`mono flex size-8 shrink-0 items-center justify-center rounded-[3px] text-[15px] font-bold ${style.bg} ${style.ink}`}
            aria-hidden
          >
            {here.level}
          </span>
          <div className="min-w-0 flex-1">
            <p className="lbl">{t("dash.bulletin_here")}</p>
            <p className={`font-display text-[13px] leading-tight font-extrabold ${style.text}`}>
              {t("ui.signal_no", { n: here.level })}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[11.5px] leading-snug text-paper-2">{t("dash.bulletin_nohere")}</p>
      )}

      {/*
        "The northern portion of Ilocos Norte (Pagudpud, Burgos…)" names the
        province without covering this barangay. The number above is then the
        bulletin's, not this barangay's, and the form is left alone.
      */}
      {here && !certain && (
        <p className="text-[11px] leading-snug text-caution">{t("dash.bulletin_partial")}</p>
      )}

      <dl className="mono grid gap-0.5 text-[10px] text-paper-2">
        {bulletin.issuedAt && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 text-paper-3">{t("dash.bulletin_issued")}</dt>
            <dd className="min-w-0 flex-1 truncate">{bulletin.issuedAt}</dd>
          </div>
        )}
        {bulletin.windKph != null && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 text-paper-3">{t("adv.wind")}</dt>
            <dd>{bulletin.windKph} KM/H</dd>
          </div>
        )}
        {bulletin.gustKph != null && (
          <div className="flex gap-1.5">
            <dt className="shrink-0 text-paper-3">{t("dash.bulletin_gusts")}</dt>
            <dd>{bulletin.gustKph} KM/H</dd>
          </div>
        )}
      </dl>

      {/* What the bulletin itself says about this level, verbatim: the official
          is being asked to check the reading, so the reading is shown. */}
      {here && <AreaText label={t("dash.bulletin_areas")} areas={here.areas} />}

      {changes ? (
        <button
          type="button"
          onClick={() =>
            onUse(
              bulletinToAdvisory(bulletin, signal, current, Date.now()),
              noteFor(bulletin, t),
            )
          }
          className="tap mono rounded-instrument border-[1.5px] border-hv text-[10px] font-bold tracking-[1px] text-hv"
        >
          {t("dash.bulletin_use")}
        </button>
      ) : (
        <p className="mono text-[9.5px] tracking-[0.7px] text-clear">
          {t("dash.bulletin_applied")}
        </p>
      )}
    </>,
  );
}

function noteFor(bulletin: Bulletin, t: (key: string, vars?: { n: number }) => string): string {
  return t("dash.from_bulletin", { n: bulletin.bulletinNo ?? 0 });
}

/** The area list, folded away: it runs to paragraphs during a big storm. */
function AreaText({ label, areas }: { label: string; areas: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-expanded={open}
        className="lbl flex items-center gap-1 text-paper-3 hover:text-paper-2"
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-180" : undefined}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <p className="mt-1 max-h-32 overflow-y-auto text-[10.5px] leading-relaxed text-paper-2">
          {areas}
        </p>
      )}
    </div>
  );
}
