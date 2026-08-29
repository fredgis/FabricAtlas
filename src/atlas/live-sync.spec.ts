import { describe, expect, it } from "vitest";
import {
  accountMatchesIdentity,
  mapSyncToAtlas,
  selectMsalAccount,
  validateRawSync,
  type MsalAccount,
  type RawSync,
} from "./live-sync";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function completeSync(): RawSync {
  return {
    workspace: { id: workspaceId, displayName: "Atlas" },
    items: [{ id: "item-1", type: "Lakehouse", displayName: "Lake" }],
    roleAssignments: [{ role: "Admin", principal: { id: "user-1" } }],
    jobs: [],
    lineage: [],
    access: [],
    config: [],
    schema: {},
    errors: [],
  };
}

describe("validateRawSync", () => {
  it("accepts a complete authoritative result", () => {
    expect(() => validateRawSync(completeSync(), workspaceId)).not.toThrow();
  });

  it("rejects reported scanner errors before persistence", () => {
    const raw = completeSync();
    raw.errors = ["scan: Tenant.Read.All is unavailable"];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /incomplete sync.*previous snapshot was preserved/i,
    );
  });

  it("rejects a missing mandatory result set", () => {
    const raw = completeSync();
    delete raw.roleAssignments;

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /missing roleAssignments.*previous snapshot was preserved/i,
    );
  });

  it("rejects empty item and role snapshots", () => {
    const raw = completeSync();
    raw.items = [];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /no workspace items.*previous snapshot was preserved/i,
    );
  });

  it("rejects placeholder item IDs and generic item types", () => {
    const missingId = completeSync();
    missingId.items = [{ id: "undefined", type: "Lakehouse" }];
    expect(() => validateRawSync(missingId, workspaceId)).toThrow(
      /invalid workspace item metadata/i,
    );

    const missingType = completeSync();
    missingType.items = [{ id: "real-id", type: "ITEM" }];
    expect(() => validateRawSync(missingType, workspaceId)).toThrow(
      /invalid workspace item metadata/i,
    );
  });

  it("falls back to the real item ID when its display name is missing", () => {
    const raw = completeSync();
    raw.items = [
      { id: "real-item-id", type: "Lakehouse", displayName: " undefined " },
    ];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.items[0]).toMatchObject({
      fabricId: "real-item-id",
      displayName: "real-item-id",
      itemType: "Lakehouse",
    });
  });
});

describe("MSAL account binding", () => {
  const accounts: MsalAccount[] = [
    {
      homeAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.tenant",
      localAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      tenantId: "tenant-a",
      username: "first@example.com",
    },
    {
      homeAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.tenant",
      localAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      tenantId: "tenant-b",
      username: "guest_name#EXT#@tenant.onmicrosoft.com",
      idTokenClaims: {
        oid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        email: "second@example.com",
      },
    },
  ];

  it("selects the account matching the current Rayfin subject", () => {
    expect(
      selectMsalAccount(accounts, {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        email: "second@example.com",
      }),
    ).toBe(accounts[1]);
  });

  it("does not fall back to the first cached account", () => {
    expect(
      selectMsalAccount(accounts, {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        email: "unknown@example.com",
      }),
    ).toBeUndefined();
  });

  it("does not select a same-email account from another tenant", () => {
    expect(
      selectMsalAccount(
        accounts,
        { email: "first@example.com" },
        "tenant-b",
      ),
    ).toBeUndefined();
  });

  it("matches normalized email claims", () => {
    expect(
      accountMatchesIdentity(accounts[1], {
        email: " SECOND@EXAMPLE.COM ",
      }),
    ).toBe(true);
  });
});

describe("object inventory mapping", () => {
  it("preserves semantic model object metadata", () => {
    const raw = completeSync();
    raw.items = [
      {
        id: "model-1",
        type: "SemanticModel",
        displayName: "Sales model",
      },
    ];
    raw.schema = {
      "model-1": [
        {
          name: "Sales",
          objectType: "Model table",
          source: "Power BI admin scanner",
          description: "Sales facts",
          columns: [
            {
              name: "Amount",
              dataType: "Decimal",
              description: "Net amount",
              isHidden: false,
            },
          ],
          measures: [
            {
              name: "Revenue",
              expression: "SUM(Sales[Amount])",
              description: "Total revenue",
              isHidden: false,
            },
          ],
        },
      ],
    };

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.schema?.["model-1"]?.[0]).toMatchObject({
      name: "Sales",
      objectType: "Model table",
      source: "Power BI admin scanner",
      description: "Sales facts",
      columns: [{ name: "Amount", description: "Net amount" }],
      measures: [
        {
          name: "Revenue",
          expr: "SUM(Sales[Amount])",
          description: "Total revenue",
        },
      ],
    });
  });
});
