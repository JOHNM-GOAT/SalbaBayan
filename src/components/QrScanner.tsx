"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { useT } from "./AppRuntime";

/**
 * Camera QR scanner (PRD §7.9, FR-9.1).
 *
 * This component only ever emits a decoded string. It knows nothing about
 * residents, tokens or check-ins — which is what keeps the camera path and the
 * manual path identical downstream, rather than two flows that drift apart.
 *
 * It also fails loudly and specifically. A scanner that shows a black
 * rectangle when permission was denied is indistinguishable from one that is
 * broken, and a volunteer at a gate will keep holding cards up to it.
 */

type ScannerState = "starting" | "scanning" | "denied" | "unsupported" | "insecure";

export function QrScanner({ onDecode }: { onDecode: (text: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const lastDecode = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const [state, setState] = useState<ScannerState>("starting");

  /*
   * The callback is held in a ref so the camera effect can depend on nothing.
   * Depending on `onDecode` directly would tear down and restart the camera
   * whenever the parent re-renders — and the parent re-renders on every scan,
   * so the scanner would restart itself in a loop.
   */
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    // An AbortController rather than a mutable local: this effect can still be
    // running after unmount, because camera permission is a prompt a user may
    // sit on for a while.
    const controller = new AbortController();
    const { signal } = controller;

    /* The scan loop lives inside the effect that owns the camera, so the
       stream, the animation frame and the teardown are all one thing. */
    const scan = () => {
      if (signal.aborted) return;

      const v = video.current;
      const c = canvas.current;

      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;

        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const image = ctx.getImageData(0, 0, c.width, c.height);
          const found = jsQR(image.data, image.width, image.height, {
            inversionAttempts: "dontInvert",
          });

          if (found?.data) {
            /*
             * A camera reads the same card many times a second. Without this
             * guard, one card held up to the lens files a dozen check-ins and
             * the roll — the record used to decide who is unaccounted for —
             * fills with duplicates. Two seconds is long enough to move a card
             * away, and short enough to work through a queue briskly.
             */
            const now = Date.now();
            const isRepeat =
              found.data === lastDecode.current.text &&
              now - lastDecode.current.at < 2000;

            if (!isRepeat) {
              lastDecode.current = { text: found.data, at: now };
              onDecodeRef.current(found.data);
            }
          }
        }
      }

      frame.current = requestAnimationFrame(scan);
    };

    /*
     * Deferred to a microtask so nothing sets state synchronously inside the
     * effect. The capability checks cannot simply be derived during render
     * either: `navigator` and `isSecureContext` do not exist on the server, so
     * computing them at render time would make the first client paint disagree
     * with the server's and break hydration.
     */
    queueMicrotask(() => {
      if (signal.aborted) return;

      // Both of these are hard stops rather than permission problems, and
      // saying which is which is the difference between "allow the camera" and
      // "this needs HTTPS" — advice a volunteer can actually act on.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState("unsupported");
        return;
      }
      if (!window.isSecureContext) {
        setState("insecure");
        return;
      }

      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "environment" } })
        .then((media) => {
          if (signal.aborted) {
            media.getTracks().forEach((track) => track.stop());
            return;
          }
          stream.current = media;
          if (video.current) {
            video.current.srcObject = media;
            void video.current.play();
          }
          setState("scanning");
          frame.current = requestAnimationFrame(scan);
        })
        .catch(() => {
          if (!signal.aborted) setState("denied");
        });
    });

    return () => {
      controller.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, []);

  const message =
    state === "denied"
      ? t("qr.denied")
      : state === "insecure"
        ? t("qr.insecure")
        : state === "unsupported"
          ? t("qr.unsupported")
          : t("qr.aim");

  const isProblem = state === "denied" || state === "insecure" || state === "unsupported";

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-instrument border-[1.5px] border-line-soft bg-ink-900">
      <video ref={video} muted playsInline className="size-full object-cover" aria-hidden />
      <canvas ref={canvas} className="hidden" />

      {/* Corner brackets: something to aim at, and a frame that holds the card
          at a distance jsQR can actually decode. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative size-[58%]">
          {(
            [
              "left-0 top-0 border-l-[3px] border-t-[3px]",
              "right-0 top-0 border-r-[3px] border-t-[3px]",
              "left-0 bottom-0 border-l-[3px] border-b-[3px]",
              "right-0 bottom-0 border-r-[3px] border-b-[3px]",
            ] as const
          ).map((corner) => (
            <span key={corner} className={`absolute size-8 border-clear ${corner}`} />
          ))}
        </div>
      </div>

      <p
        className={`mono absolute inset-x-0 bottom-0 bg-ink-900/85 px-3 py-2 text-[10px] leading-snug tracking-[0.7px] ${
          isProblem ? "text-caution" : "text-paper-3"
        }`}
        role={isProblem ? "status" : undefined}
      >
        {message}
      </p>
    </div>
  );
}
