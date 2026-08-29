import { describe, expect, it } from "vitest";
import {
  navigationForSavedView,
  navigationForSearch,
} from "./navigation";
import type { SearchResult } from "./search";

function result(
  target: SearchResult["target"],
  title = "Result",
): SearchResult {
  return {
    id: "result",
    kind: target.kind,
    title,
    target,
    searchText: title.toLowerCase(),
    normalizedTitle: title.toLowerCase(),
    score: 100,
  };
}

describe("Atlas navigation", () => {
  it("maps schema search results to the Asset Catalog", () => {
    expect(
      navigationForSearch(
        result(
          {
            kind: "measure",
            itemId: "item-1",
            tableName: "Sales",
            objectName: "Revenue",
          },
          "Revenue",
        ),
      ),
    ).toMatchObject({
      tab: "assets",
      focus: {
        itemId: "item-1",
        tableName: "Sales",
        objectName: "Revenue",
        objectKind: "measure",
      },
    });
  });

  it("opens comments in Workspace Hub notes", () => {
    expect(
      navigationForSearch(
        result({
          kind: "comment",
          itemId: "item-1",
          commentId: "comment-1",
        }),
      ),
    ).toMatchObject({
      tab: "workspace",
      focus: {
        workspaceSection: "notes",
        commentId: "comment-1",
      },
    });
  });

  it("maps saved governance filters to the requested section", () => {
    expect(
      navigationForSavedView("governance", {
        section: "changes",
        domain: "access",
      }),
    ).toMatchObject({
      tab: "governance",
      focus: {
        governanceSection: "changes",
        filters: { section: "changes", domain: "access" },
      },
    });
  });
});
