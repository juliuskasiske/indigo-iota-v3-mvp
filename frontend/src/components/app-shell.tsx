"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  FolderKanban,
  Settings,
  Search,
  Bell,
  PlusCircle,
} from "lucide-react";
import { IotaLogo } from "./iota-logo";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { cn, initials } from "@/lib/utils";
import { currentUser } from "@/lib/mock/data";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  match?: (pathname: string) => boolean;
}

const navItems: NavItem[] = [
  {
    href: "/demo",
    label: "Dashboard",
    icon: LayoutGrid,
    match: (p) => p === "/demo",
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    match: (p) => p.startsWith("/projects"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    match: (p) => p.startsWith("/settings"),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative flex min-h-screen w-full">
      <aside className="hidden md:flex sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-border bg-background-elevated/60 backdrop-blur-md">
        <div className="flex flex-col gap-1 px-5 pt-6 pb-6">
          <IotaLogo size={26} />
          <span className="text-[11px] text-foreground-subtle">
            Project Brain
          </span>
        </div>

        <div className="px-3 mb-4">
          <Button
            asChild
            variant="primary"
            size="sm"
            className="w-full justify-start"
          >
            <Link href="/projects/new">
              <PlusCircle className="h-4 w-4" />
              Initialize Project
            </Link>
          </Button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.match ? item.match(pathname) : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-foreground-muted hover:text-foreground hover:bg-background-soft"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-border">
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(currentUser.name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-xs font-medium text-foreground truncate">
                {currentUser.name}
              </span>
              <span className="text-[10px] text-foreground-subtle truncate">
                {currentUser.company}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0 relative">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end border-b border-border bg-background/70 backdrop-blur-md px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-foreground-muted">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-foreground-muted">
              <Bell className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="relative flex-1">{children}</main>
      </div>
    </div>
  );
}
