"use client";

import { useSyncExternalStore } from "react";
import { STORAGE_KEY, THEME_COLOR, type Theme } from "../lib/theme";

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const currentTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const serverTheme = (): Theme => "light";

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private windows can refuse storage. The switch still works until the page closes.
  }
  listeners.forEach((listener) => listener());
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid size-11 shrink-0 place-items-center transition-colors duration-150 hover:bg-surface active:bg-bg sm:size-9 ${className}`}
    >
      <svg viewBox="0 0 16 16" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13" />
          </>
        ) : (
          <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
