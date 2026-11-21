"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light" | "system";

const THEME_STORAGE_KEY = "sparkweb:theme";

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") {
      return stored;
    }
    return "dark";
  } catch {
    return "dark";
  }
}

export function applyThemeClass(theme: ThemeMode): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const hasMatchMedia = typeof window.matchMedia === "function";
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      hasMatchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
    return "dark";
  }
  root.classList.remove("dark");
  return "light";
}

export function useTheme(defaultTheme: ThemeMode = "dark") {
  const [theme, setThemeState] = useState<ThemeMode>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    const resolved = applyThemeClass(initial);
    setResolvedTheme(resolved);
    setIsMounted(true);

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        const current = readStoredTheme();
        if (current === "system") {
          setResolvedTheme(applyThemeClass("system"));
        }
      };
      mediaQuery.addEventListener?.("change", handleChange);
      return () => mediaQuery.removeEventListener?.("change", handleChange);
    }
  }, []);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (err) {
      console.warn("Failed to save theme to localStorage", err);
    }
    const resolved = applyThemeClass(nextTheme);
    setResolvedTheme(resolved);
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme,
    isMounted,
  };
}
