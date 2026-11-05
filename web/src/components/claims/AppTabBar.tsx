"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Icon, ICONS } from "../home/phoneBits";

const ITEMS = [
  { href: "/claims", label: "calls", icon: ICONS.toll },
  { href: "/jury", label: "jury", icon: ICONS.balance },
  { href: "/agents", label: "agents", icon: ICONS.robot },
  { href: "/attack", label: "attack", icon: ICONS.shield },
];

function Bar({ path }: { path: string }) {
  return (
    <nav aria-label="Main" className="md:hidden fixed bottom-0 left-0 w-full z-50 bg-bg/90 backdrop-blur-xl shadow-[0_-1px_8px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom,0px)]">
      <div className="flex items-stretch justify-around h-16">
        {ITEMS.map((item) => {
          const active = path === item.href || path.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex-1 flex flex-col items-center justify-center min-h-11 min-w-11 no-underline ${active ? "text-night bg-yellow font-bold" : "text-muted"}`}
            >
              <Icon d={item.icon} className="size-[22px]" />
              <span className="text-[11px] uppercase tracking-wider mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function CurrentBar() {
  return <Bar path={usePathname()} />;
}

// Stitch's phone tab bar, on every app screen. The address is only known at request time, so the bar
// is drawn without a highlighted tab until then.
export function AppTabBar() {
  return (
    <Suspense fallback={<Bar path="" />}>
      <CurrentBar />
    </Suspense>
  );
}
