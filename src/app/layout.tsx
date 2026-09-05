import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppRuntime } from "@/components/AppRuntime";
import { AppHeader } from "@/components/AppHeader";

/*
 * Fonts are self-hosted by next/font rather than linked from the Google Fonts
 * CDN as the wireframes did. Deliberate: a CDN link fails offline, and this is
 * an offline-first product. Self-hosted files get precached with the app shell.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SalbaBayan",
  description:
    "Barangay-level typhoon early warning and evacuation coordination that keeps working offline.",
  manifest: "/manifest.webmanifest",
  applicationName: "SalbaBayan",
  appleWebApp: { capable: true, title: "SalbaBayan", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0e12",
  // The app is a field instrument, not a document: zooming breaks the fixed
  // thumb-zone layout the controls depend on.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    /*
     * The font variable classes belong on <html>, NOT <body>. Tailwind v4 emits
     * the `@theme` tokens onto `:root`, and a `var()` inside a custom-property
     * declaration resolves against the element that declares it. With the
     * classes on <body>, `--font-display: var(--font-archivo), ...` resolved on
     * :root against an undefined `--font-archivo`, yielding an invalid
     * font-family that silently dropped the whole app to Times New Roman.
     */
    <html
      lang="fil"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="bg-ink-900 text-paper antialiased">
        {/*
         * The header — severity rail, wordmark, language switch, sync strip —
         * is rendered HERE rather than by each page.
         *
         * PRD §6 and FR-3.5 require cache age and queued-write count to be
         * visible on every screen, never a toast. Leaving that to each page to
         * remember makes it a convention that holds until someone adds a route
         * and forgets. Putting it in the layout makes it structural: a new
         * screen cannot ship without it.
         */}
        <AppRuntime>
          <div className="flex min-h-dvh flex-col bg-ink-900">
            <AppHeader />
            {children}
          </div>
        </AppRuntime>
      </body>
    </html>
  );
}
