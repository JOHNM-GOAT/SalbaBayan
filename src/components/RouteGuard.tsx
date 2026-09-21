"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMyRole } from "./useMyRole";

/** Pages only an official may open, and pages for volunteers and officials. */
const OFFICIAL_ONLY = ["/official", "/readiness", "/coverage", "/advisory"];
const STAFF_ONLY = ["/volunteer", "/checkin", "/responder", "/headcount"];

const matches = (pathname: string, list: string[]) =>
  list.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Sends a device away from pages its role does not cover: an official page to
 * the official login, a staff page to the resident home. A display rule
 * only — RLS already refuses the data — but it means a resident who types an
 * official address meets the login, not a screen of empty panels.
 *
 * Waits for the role (null while unknown), so an official is never bounced
 * during the moment their role is still loading.
 */
export function RouteGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useMyRole();

  useEffect(() => {
    if (role === null) return;
    if (matches(pathname, OFFICIAL_ONLY) && role !== "official") router.replace("/official-login");
    else if (matches(pathname, STAFF_ONLY) && role === "resident") router.replace("/");
  }, [pathname, role, router]);

  return null;
}
