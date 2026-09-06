"use client";

import { useEffect, useState } from "react";
import { signedPhotoUrl } from "@/lib/photoQueue";

/**
 * A hazard photo from the private bucket.
 *
 * The bucket is not public (migration 0009), so there is no URL to put in an
 * `src` directly — each view needs a short-lived signed URL. That is the cost
 * of not handing out permanent public links to photographs of people's homes
 * during a disaster, and it is worth paying.
 *
 * Renders nothing at all when the URL cannot be signed, which is the common
 * case offline. An empty space is better than a broken-image icon: the latter
 * reads as "the photo was lost", when in fact it is simply not reachable right
 * now and the report itself is perfectly intact.
 */
export function HazardPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void signedPhotoUrl(path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="mt-2 h-28 w-full rounded-[3px] border border-line-soft object-cover"
    />
  );
}
