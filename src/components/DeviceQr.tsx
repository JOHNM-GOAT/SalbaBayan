"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The device code as a QR, so an official can scan it instead of having it
 * read aloud. Generated on the phone, so it works offline. Black on white with
 * a quiet zone regardless of theme: phone cameras read that most reliably.
 */
export function DeviceQr({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void QRCode.toString(code, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    }).then((markup) => {
      if (live) setSvg(markup);
    });
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <div
      role="img"
      aria-label={code}
      className="size-[168px] shrink-0 rounded-[3px] bg-white [&>svg]:size-full"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
