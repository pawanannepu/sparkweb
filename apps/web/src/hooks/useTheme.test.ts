import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { applyThemeClass, readStoredTheme, useTheme } from "./useTheme";

describe("useTheme Hook", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("reads default dark theme when nothing is stored", () => {
    expect(readStoredTheme()).toBe("dark");
  });

  it("applies dark class to documentElement for dark mode", () => {
    const resolved = applyThemeClass("dark");
    expect(resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class for light mode", () => {
    document.documentElement.classList.add("dark");
    const resolved = applyThemeClass("light");
    expect(resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("updates and stores theme selection", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(localStorage.getItem("sparkweb:theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
