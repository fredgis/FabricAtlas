import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppTheme } from "./use-theme";

describe("useAppTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("defaults to dark and persists an explicit light preference", async () => {
    const { result } = renderHook(() => useAppTheme());

    expect(result.current.isDark).toBe(true);
    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(true),
    );

    act(() => result.current.toggleTheme());

    expect(result.current.isDark).toBe(false);
    await waitFor(() => expect(localStorage.getItem("atlas.theme")).toBe("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("restores a saved light preference", () => {
    localStorage.setItem("atlas.theme", "light");

    const { result } = renderHook(() => useAppTheme());

    expect(result.current.isDark).toBe(false);
  });
});
