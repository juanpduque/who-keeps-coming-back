import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Anton, Source_Serif_4, Space_Mono } from "next/font/google";
import "./globals.css";

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space",
});

export const metadata: Metadata = {
  title: "Who keeps coming back — Pulp Analytics",
  description: "Who gets billed together in horror, and who keeps directing the same people.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${sourceSerif.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
