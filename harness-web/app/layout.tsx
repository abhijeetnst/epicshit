import type { Metadata } from "next";
import { Fragment_Mono, Hanken_Grotesk, Silkscreen } from "next/font/google";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const fragment = Fragment_Mono({
  variable: "--font-fragment",
  weight: "400",
  subsets: ["latin"],
});

const silkscreen = Silkscreen({
  variable: "--font-silkscreen",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DopeCode",
  description: "Your local coding agent, with a crew.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions (ColorZilla, Grammarly, Dark Reader…) add attributes to
    // <html>/<body> before React hydrates; this ignores only those two tags' attributes.
    <html
      lang="en"
      className={`${hanken.variable} ${fragment.variable} ${silkscreen.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
