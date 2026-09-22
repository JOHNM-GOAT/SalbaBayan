"use client";

import { useState } from "react";
import { useSync, useT } from "../AppRuntime";
import { HoldToConfirm } from "../HoldToConfirm";
import { submitHazard, type Category } from "@/lib/hazards";
import { DEPTHS, submitWaterReport, type WaterLevel } from "@/lib/water";
import { MAX_CENTRES, parseCapacity } from "@/lib/centres";
import { CENTRE_ICON, HAZARD_ICON, WATER_ICON, teardropSvg } from "@/lib/mapMarks";

/** What the official is placing at the tapped spot. */
export type PinKind = "hazard" | "water" | "evacuate";

export type Draft = {
  lat: number;
  lng: number;
  street: string | null;
  purokId: string | null;
};

/* Flooding is not offered: the Water / Flood choice records it with a depth. */
const HAZARDS: { category: Category; key: string }[] = [
  { category: "fallen_tree", key: "dash.h_fallen_tree" },
  { category: "blocked_road", key: "dash.h_blocked_road" },
  { category: "downed_lines", key: "dash.h_downed_lines" },
  { category: "other", key: "dash.h_other" },
];

const DEPTH_TONE: Record<WaterLevel, string> = {
  none: "col-span-2 border-line text-paper-2",
  knee: "border-clear text-clear",
  waist: "border-caution text-caution",
  chest: "border-alarm text-alarm",
  above_head: "border-alarm bg-alarm/10 text-alarm",
};

function Icon({ markup, colour }: { markup: string; colour: string }) {
  return (
    <span
      className="shrink-0"
      aria-hidden
      // Same pin as the map draws, so the choice reads as the mark it leaves.
      dangerouslySetInnerHTML={{ __html: teardropSvg(colour, markup, 22) }}
    />
  );
}

/**
 * The pin-and-expand menu: what the tapped spot is. Hazard and Water / Flood
 * expand in place to one more choice and save on it; Evacuate hands over to the
 * centre form, which needs a name.
 */
export function PinMenu({
  draft,
  kind,
  onKind,
  onEvacuate,
  onDone,
  onClose,
}: {
  draft: Draft;
  kind: PinKind | null;
  onKind: (kind: PinKind | null) => void;
  onEvacuate: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { snapshot } = useSync();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const full = (snapshot?.centers.length ?? 0) >= MAX_CENTRES;
  const at = { lat: draft.lat, lng: draft.lng };

  const save = async (write: () => Promise<unknown>) => {
    if (busy || !draft.purokId) return;
    setBusy(true);
    try {
      await write();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const option = (id: PinKind, label: string, markup: string, colour: string) => (
    <button
      type="button"
      onClick={() => onKind(kind === id ? null : id)}
      aria-expanded={kind === id}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-[3px] border-[1.5px] px-2.5 text-left ${
        kind === id ? "border-hv bg-hv/10" : "border-line-soft bg-ink-800 hover:border-line"
      }`}
    >
      <Icon markup={markup} colour={colour} />
      <span className="mono flex-1 text-[11px] font-bold tracking-[0.8px]">{label}</span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`text-paper-3 transition-transform ${kind === id ? "rotate-90" : ""}`}
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );

  return (
    <div className="grid w-[17rem] max-w-full gap-2 rounded-instrument border-[1.5px] border-line bg-ink-900 p-2.5 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[14px] leading-tight font-extrabold">
            {draft.street?.toUpperCase() ?? t("dash.no_street")}
          </p>
          <p className="mono text-[9.5px] text-paper-3">
            {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("hz.close")}
          className="-mt-1 shrink-0 px-1 text-[20px] leading-none text-paper-3"
        >
          ×
        </button>
      </div>

      {option("hazard", t("dash.pin_hazard"), HAZARD_ICON.other, "var(--color-alarm)")}
      {kind === "hazard" && (
        <div className="grid gap-1.5 border-l-2 border-hv pl-2.5">
          <p className="lbl text-[9px]">{t("dash.which_hazard")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {HAZARDS.map(({ category, key }) => (
              <button
                key={category}
                type="button"
                disabled={busy}
                onClick={() => void save(() => submitHazard({ purokId: draft.purokId!, category, at }))}
                className="mono flex min-h-10 items-center gap-1.5 rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 px-2 text-left text-[9.5px] leading-tight font-bold tracking-[0.5px] hover:border-caution disabled:opacity-40"
              >
                <Icon markup={HAZARD_ICON[category]} colour="var(--color-caution)" />
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      )}

      {option("water", t("dash.pin_water"), WATER_ICON, "var(--color-hv)")}
      {kind === "water" && (
        <div className="grid gap-1.5 border-l-2 border-hv pl-2.5">
          <p className="lbl text-[9px]">{t("dash.which_depth")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[...DEPTHS, "none" as const].map((depth: WaterLevel) => (
              <button
                key={depth}
                type="button"
                disabled={busy}
                onClick={() =>
                  void save(() =>
                    submitWaterReport({
                      purokId: draft.purokId!,
                      depth,
                      locationLabel: draft.street ?? undefined,
                      at,
                    }),
                  )
                }
                className={`mono min-h-10 rounded-[3px] border-[1.5px] bg-ink-800 px-2 text-[10px] font-bold tracking-[0.6px] disabled:opacity-40 ${DEPTH_TONE[depth]}`}
              >
                {depth === "none" ? t("dash.no_water") : t(`water.${depth}`)}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] leading-snug text-paper-3">{t("dash.replaces")}</p>
        </div>
      )}

      {option("evacuate", t("dash.pin_evacuate"), CENTRE_ICON, "var(--color-clear)")}
      {kind === "evacuate" && (
        <div className="grid gap-1.5 border-l-2 border-hv pl-2.5">
          {full ? (
            <p className="text-[11.5px] leading-snug text-caution">{t("dash.centres_full")}</p>
          ) : (
            <button
              type="button"
              onClick={onEvacuate}
              className="tap mono rounded-[3px] bg-hv text-[10.5px] font-bold tracking-[0.8px] text-hv-ink"
            >
              {t("dash.new_centre")}
            </button>
          )}
          <p className="mono text-[9px] tracking-[0.5px] text-paper-3">
            {t("dash.centres_of", { n: snapshot?.centers.length ?? 0 })}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Name and capacity of an evacuation centre — a new one at the tapped spot, or
 * an existing one being edited. An overlay, over the map.
 */
export function CentreModal({
  title,
  place,
  initial,
  holdLabel,
  onSave,
  onCancel,
}: {
  title: string;
  /** The street, or coordinates, of the spot. */
  place: string;
  initial: { name: string; capacity: number | null };
  holdLabel: string;
  onSave: (input: { name: string; capacity: number | null }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [capacity, setCapacity] = useState(initial.capacity == null ? "" : String(initial.capacity));
  const capacityValue = parseCapacity(capacity);
  const canSave = name.trim() !== "" && name.trim().length <= 80 && capacityValue !== undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-paper/30 p-3 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="grid w-full max-w-sm gap-3 rounded-instrument border-[1.5px] border-line bg-ink-900 p-4 shadow-2xl"
      >
        <div>
          <p className="lbl">{title}</p>
          <p className="mono mt-0.5 truncate text-[10px] tracking-[0.5px] text-paper-3">{place}</p>
        </div>

        <label className="grid gap-1.5">
          <span className="lbl">{t("ce.name")}</span>
          <input
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper focus:border-hv focus:outline-none"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="lbl">{t("ce.capacity")}</span>
          <input
            inputMode="numeric"
            value={capacity}
            placeholder={t("ce.capacity_unset")}
            onChange={(event) => setCapacity(event.target.value)}
            className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
          />
        </label>

        {capacityValue === undefined && (
          <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
            {t("ce.capacity_invalid")}
          </p>
        )}

        {canSave ? (
          <HoldToConfirm
            label={holdLabel}
            holdingLabel={t("sos.cancelling")}
            tone="accent"
            onConfirm={() => onSave({ name: name.trim(), capacity: capacityValue ?? null })}
          />
        ) : (
          <button
            type="button"
            disabled
            className="tap rounded-instrument border-[1.5px] border-line-soft bg-ink-800 py-3 text-[13px] font-semibold text-paper-3 opacity-60"
          >
            {holdLabel}
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
        >
          {t("ce.cancel")}
        </button>
      </section>
    </div>
  );
}
