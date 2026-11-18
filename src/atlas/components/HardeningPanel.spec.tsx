import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { recommendedCsp } from "../csp";
import { HardeningPanel } from "./HardeningPanel";

describe("HardeningPanel", () => {
  it("lists the checklist and copies the recommended CSP", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<HardeningPanel />);
    expect(screen.getByText(/Atlas cannot read what your tenant enforces/)).toBeTruthy();
    expect(screen.getByText(/Item identity/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy recommended CSP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(recommendedCsp());
    vi.unstubAllGlobals();
  });
});
