"use client";

import { useRouter } from "next/navigation";
import { AdvisoryEditor } from "@/components/AdvisoryEditor";

/**
 * The advisory form on its own page, for an old link or bookmark. The
 * dashboard opens the same form as an overlay (AdvisoryModal).
 */
export default function AdvisoryPage() {
  const router = useRouter();
  return (
    <main className="mx-auto w-full max-w-lg flex-1">
      <AdvisoryEditor onClose={() => router.push("/official")} />
    </main>
  );
}
