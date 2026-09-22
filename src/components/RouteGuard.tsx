"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMyRole } from "./useMyRole";
import { useOfficialAccess } from "./useOfficialAccess";
import { lockOfficialPages } from "@/lib/officialAccess";

/** Pages only an official may open, and pages for volunteers and officials. */
const OFFICIAL_ONLY = ["/official", "/readiness", "/coverage", "/advisory", "/users"];
const STAFF_ONLY = ["/volunteer", "/checkin", "/responder", "/headcount"];

const matches = (pathname: string, list: string[]) =>
  list.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Sends a device away from pages its role does not cover: an official page to
 * the official login (which also asks for the PIN each time the app is
 * opened), a staff page to the resident home. A display rule only — RLS
 * already refuses the data — but a resident who types an official address
 * meets the login, not a screen of empty panels.
 *
 * Waits for the role and the unlock state (null while unknown), so an official
 * is never bounced during the moment they are still loading.
 */
export function RouteGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useMyRole();
  const { unlocked } = useOfficialAccess();

  // A device that is no longer an official loses its unlock at once.
  useEffect(() => {
    if (role !== null && role !== "official" && unlocked) lockOfficialPages();
  }, [role, unlocked]);

  useEffect(() => {
    if (role === null || unlocked === null) return;
    if (matches(pathname, OFFICIAL_ONLY) && (role !== "official" || !unlocked)) {
      router.replace("/official-login");
    } else if (matches(pathname, STAFF_ONLY) && role === "resident") {
      router.replace("/");
    }
  }, [pathname, role, unlocked, router]);

  return null;
}
