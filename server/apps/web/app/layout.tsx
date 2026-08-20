import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

// Self-hosted: next/font downloads at build time and serves from our own origin, so a
// visitor to the privacy notice makes zero third-party requests while reading a page
// that claims there are no third-party recipients.
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/brand/peraplano-favicon.svg", type: "image/svg+xml" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

// Applied before first paint; a React-only toggle flashes the light theme first.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('pp-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
