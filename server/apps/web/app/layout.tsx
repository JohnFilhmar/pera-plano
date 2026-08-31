import type { Metadata } from "next";
import { Bricolage_Grotesque, Manrope } from "next/font/google";
import "./globals.css";

// Self-hosted: next/font downloads at build time and serves from our own origin, so a
// visitor to the privacy notice makes zero third-party requests while reading a page
// that claims there are no third-party recipients. The same applies to the display face.
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

// h1 and h2 only, per the revamp spec §4. Chosen because its slightly irregular optical
// sizing reads warm rather than institutional, which is the register a finance app owned
// by one person should have — and because it is not the serif that every generated
// landing page reaches for. Swapping it is this one line.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/brand/peraplano-favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

// Applied before first paint; a React-only toggle flashes the light theme first. The
// data-js flag rides along because the reveal styles hide content until it is scrolled
// into view: gating that on a flag only a running script can set means a reader without
// JavaScript, and any crawler that does not execute it, is never shown a blank page.
const THEME_BOOTSTRAP = `(function(){var d=document.documentElement;d.setAttribute('data-js','');try{var t=localStorage.getItem('pp-theme');if(t==='dark'||t==='light'){d.setAttribute('data-theme',t)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
