"use client";
import { Boxes, Check, CircleHelp, Monitor, Moon, Search, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { AboutDialog } from "@/components/about-dialog";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildInfo, versionLabel } from "@/lib/app-version";
import { cn } from "@/lib/utils";

export function AppHeader({ docsUrl }: { docsUrl?: string }) {
  const path = usePathname();
  const { theme, setTheme } = useTheme();
  const [palette, setPalette] = useState(false);
  const [about, setAbout] = useState(false);
  const label = versionLabel(buildInfo());

  // Ctrl/Cmd+K opens the palette from anywhere (and closes it again).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links = [
    { href: "/", label: "Targets", active: path === "/" || path.startsWith("/t/") },
    { href: "/fixtures", label: "Fixtures", active: path.startsWith("/fixtures") },
    { href: "/activity", label: "Activity", active: path.startsWith("/activity") },
  ];

  const themes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="flex h-12 items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Boxes className="size-5 text-primary" />
          <span className="hidden sm:inline">Emulator Console</span>
        </Link>
        <button
          type="button"
          onClick={() => setAbout(true)}
          aria-label={`About Emulator Console, version ${label}`}
          data-testid="app-version"
          className="-ml-1 hidden rounded px-1 text-xs text-muted-foreground hover:text-foreground sm:inline"
        >
          {label}
        </button>
        <nav className="ml-2 flex items-center gap-1" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                l.active && "bg-accent font-medium text-accent-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="hidden h-8 w-56 justify-start gap-2 text-muted-foreground sm:inline-flex"
            onClick={() => setPalette(true)}
          >
            <Search /> <span className="flex-1 text-left font-normal">Search…</span>
            <kbd className="rounded border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setPalette(true)}
            aria-label="Open command palette"
          >
            <Search />
          </Button>
          {docsUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a href={docsUrl} target="_blank" rel="noopener noreferrer" aria-label="Help: open the user guide">
                <CircleHelp />
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Theme">
                <Sun className="dark:hidden" />
                <Moon className="hidden dark:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {themes.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
                  <t.icon />
                  {t.label}
                  {theme === t.id && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <AboutDialog open={about} onOpenChange={setAbout} docsUrl={docsUrl} />
    </header>
  );
}
