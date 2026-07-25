import type { Metadata } from "next";
import { Albert_Sans, Instrument_Serif } from "next/font/google";
import { ProjectsProvider } from "@/lib/store/projects-store";
import "./globals.css";

const albertSans = Albert_Sans({
  variable: "--font-albert-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic"],
});

export const metadata: Metadata = {
  title: "Indigo Iota — the project brain for consultancies",
  description:
    "Indigo Iota auto-maintains a project knowledge graph from your team's email, Slack, and shared files so consultants stop spending their week aligning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${albertSans.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ProjectsProvider>{children}</ProjectsProvider>
      </body>
    </html>
  );
}
