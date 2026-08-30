import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasProvider } from "../store";
import { AssetCatalogView } from "./AssetCatalog";

describe("AssetCatalogView", () => {
  it("opens matching groups during search and restores collapsed state", () => {
    render(
      <AtlasProvider isPreview>
        <AssetCatalogView />
      </AtlasProvider>,
    );

    expect(
      screen.queryByRole("button", { name: /Total Revenue/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search assets"), {
      target: { value: "Total Revenue" },
    });
    expect(
      screen.getByRole("button", { name: /Total Revenue/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear asset search" }));
    expect(
      screen.queryByRole("button", { name: /Total Revenue/ }),
    ).not.toBeInTheDocument();
  });

  it("omits a selected asset when the visible kind filter excludes it", () => {
    const onStateChange = vi.fn();
    render(
      <AtlasProvider isPreview>
        <AssetCatalogView
          focus={{
            requestId: "focused-table",
            itemId: "10000000-0000-4000-8000-000000000001",
            objectName: "rentals",
            objectKind: "table",
          }}
          onStateChange={onStateChange}
        />
      </AtlasProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Measures/ }));
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          objectName: undefined,
          objectKind: undefined,
          filters: { kind: "measure" },
        }),
      }),
    );
  });
});
