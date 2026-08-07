import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, Mail, CalendarClock } from "lucide-react";
import { IotaLogo } from "@/components/iota-logo";
import { Button } from "@/components/ui/button";

const CALENDLY_URL = "https://calendly.com/hey-indigo-iota/30min";

export const metadata: Metadata = {
  title: "Indigo Iota",
  description:
    "The project brain for consultancies. Sign in, explore the demo, or book a walkthrough.",
};

/**
 * Public landing page served at the app root ("/").
 *
 * The marketing site links here, so we greet visitors with a choice rather than
 * dropping them into the (non-functional) mockup demo. Sign in is the primary
 * action — it signals there's a real, working product — with the demo and a
 * Calendly booking offered as two equal options below it.
 */
export default function Landing() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background-elevated p-8 shadow-xl shadow-black/5">
        <div className="flex flex-col items-center text-center">
          <IotaLogo size={40} />
          <p className="mt-4 text-sm text-foreground-muted">
            The project brain for consultancies.
          </p>

          {/* Primary action — sign in to the real product. */}
          <div className="mt-8 w-full">
            <Button asChild variant="primary" size="lg" className="w-full">
              <Link href="/admin">
                <LogIn className="h-4 w-4" />
                Sign in
              </Link>
            </Button>
            <p className="mt-2 text-xs text-foreground-subtle">
              Already have beta access? Sign in to your Admin Center.
            </p>
          </div>

          {/* Divider */}
          <div className="my-7 flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] text-foreground-subtle">
              New here?
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Two equal-weight options. */}
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            <Button asChild variant="outline" className="w-full">
              <a href="mailto:hey@indigo-iota.com">
                <Mail className="h-4 w-4" />
                Join the waitlist
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
                <CalendarClock className="h-4 w-4" />
                Schedule a demo
              </a>
            </Button>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-foreground-subtle">
            Join the waitlist, or book a walkthrough with us — no account needed.
          </p>
        </div>
      </div>
    </main>
  );
}
