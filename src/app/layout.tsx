import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

// shadcn's globals.css reads --font-sans / --font-geist-mono.
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE = "https://transcripts.fyi";
const DESCRIPTION = "Understand a company through its earnings calls — twenty quarters, read one at a time, drawn together into one interactive explainer.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "transcripts.fyi", template: "%s · transcripts.fyi" },
  description: DESCRIPTION,
  applicationName: "transcripts.fyi",
  openGraph: { type: "website", siteName: "transcripts.fyi", locale: "en_US", url: SITE, title: "transcripts.fyi", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "transcripts.fyi", description: DESCRIPTION },
  robots: { index: true, follow: false },
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the class on <html> before hydration.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Sausage drawer: decide open/closed from localStorage before first paint (see sausage-layout.tsx). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var v=localStorage.getItem("tfyi:sausage-open");document.documentElement.dataset.sausage=v!==null?(v==="0"?"0":"1"):(matchMedia("(min-width:768px)").matches?"1":"0")}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
