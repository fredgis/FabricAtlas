import { describe, expect, it } from "vitest";
import {
  accountMatchesIdentity,
  mapSyncToAtlas,
  normalizeFabricTimestamp,
  parseSyncResponseText,
  readBoundedResponseText,
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

  describe("sync response parsing", () => {
    it("unwraps a Fabric UDF output envelope", () => {
      expect(
        parseSyncResponseText(
          JSON.stringify({ output: completeSync() }),
          100_000,
        ),
      ).toMatchObject({
        workspace: { id: workspaceId },
      });
    });

    it("rejects oversized and malformed payloads", () => {
      expect(() =>
        parseSyncResponseText(JSON.stringify({ output: completeSync() }), 10),
      ).toThrow(/exceeded.*safety limit/i);
      expect(() => parseSyncResponseText("{", 100)).toThrow(
        /invalid sync response/i,
      );
    });

    it("stops reading a streamed response above the byte limit", async () => {
      const response = new Response("0123456789abcdef");

      await expect(readBoundedResponseText(response, 8)).rejects.toThrow(
        /exceeded.*safety limit/i,
      );
    });
  });

  it("rejects reported scanner errors before persistence", () => {
    const raw = completeSync();
    raw.errors = ["scan: Tenant.Read.All is unavailable"];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /incomplete sync.*previous snapshot was preserved/i,
    );
  });

  it("accepts optional v2 section failures when required sections completed", () => {
    const raw = completeSync();
    raw.schemaVersion = 2;
    raw.sections = {
      workspace: { status: "complete" },
      items: { status: "complete" },
      roleAssignments: { status: "complete" },
      scanner: { status: "complete" },
      schema: { status: "complete" },
      lineage: { status: "complete" },
      access: { status: "complete" },
      config: { status: "complete" },
      jobs: { status: "failed", code: "transient-upstream" },
    };
    raw.capabilities = {
      endorsement: { status: "complete" },
      sensitivity: { status: "complete" },
      tags: { status: "complete" },
      ownership: { status: "complete", code: "type-specific" },
    };
    raw.itemMetadata = {
      "item-1": { scannerMatched: true },
    };
    raw.errors = ["jobs: transient upstream failure"];

    expect(() => validateRawSync(raw, workspaceId)).not.toThrow();
  });

  it("rejects failed required v2 sections", () => {
    const raw = completeSync();
    raw.schemaVersion = 2;
    raw.sections = {
      workspace: { status: "complete" },
      items: { status: "complete" },
      roleAssignments: { status: "complete" },
      scanner: { status: "failed", code: "scanner-failed" },
      schema: { status: "complete" },
      lineage: { status: "complete" },
      access: { status: "complete" },
      config: { status: "complete" },
    };
    raw.capabilities = {
      endorsement: { status: "complete" },
      sensitivity: { status: "complete" },
      tags: { status: "complete" },
      ownership: { status: "complete", code: "type-specific" },
    };
    raw.itemMetadata = {
      "item-1": { scannerMatched: true },
    };
    raw.errors = ["scanner: failed"];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /incomplete sync.*scanner/i,
    );
  });

  it("rejects a missing mandatory result set", () => {
    const raw = completeSync();
    delete raw.roleAssignments;

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /missing roleAssignments.*previous snapshot was preserved/i,
    );
  });

  it("accepts an empty workspace when mandatory sections completed", () => {
    const raw = completeSync();
    raw.items = [];

    expect(() => validateRawSync(raw, workspaceId)).not.toThrow();
  });

  it("rejects an empty role snapshot", () => {
    const raw = completeSync();
    raw.roleAssignments = [];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /no workspace role assignments.*previous snapshot was preserved/i,
    );
  });

  it("normalizes Fabric timestamps without zones as UTC", () => {
    expect(normalizeFabricTimestamp("2026-08-30T08:15:00")).toBe(
      "2026-08-30T08:15:00.000Z",
    );
    expect(normalizeFabricTimestamp("2026-08-30T10:15:00+02:00")).toBe(
      "2026-08-30T08:15:00.000Z",
    );
  });

  it("does not invent lineage from matching display names", () => {
    const raw = completeSync();
    raw.items = [
      { id: "lake", type: "Lakehouse", displayName: "Shared" },
      { id: "endpoint", type: "SQLEndpoint", displayName: "Shared" },
    ];
    raw.lineage = [];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.edges).toEqual([]);
  });

  it("rejects non-numeric schema rows at the client boundary", () => {
    const raw = completeSync();
    raw.schema = {
      "item-1": [
        {
          name: "Unsafe",
          rows: [{ businessValue: "must not cross" }] as unknown as number,
          columns: [],
          measures: [],
        },
      ],
    };

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /non-numeric row count/i,
    );
  });

  it("rejects malformed nested section records", () => {
    const raw = completeSync();
    raw.access = [
      {
        itemId: "item-1",
        accessRight: "Read",
      },
    ];

    expect(() => validateRawSync(raw, workspaceId)).toThrow(
      /malformed section records/i,
    );
  });

  it("maps authoritative scanner metadata without inventing ownership", () => {
    const raw = completeSync();
    raw.schemaVersion = 2;
    raw.sections = {
      workspace: { status: "complete" },
      items: { status: "complete" },
      roleAssignments: { status: "complete" },
      scanner: { status: "complete" },
      schema: { status: "complete" },
      lineage: { status: "complete" },
      access: { status: "complete" },
      config: { status: "complete" },
    };
    raw.capabilities = {
      endorsement: { status: "complete" },
      sensitivity: { status: "complete" },
      tags: { status: "complete" },
      ownership: { status: "complete", code: "type-specific" },
    };
    raw.syncedAt = "2026-08-30T09:00:00";
    raw.itemMetadata = {
      "item-1": {
        scannerMatched: true,
        ownerAvailable: false,
        configuredBy: "builder@example.com",
        modifiedBy: "editor@example.com",
        modifiedDateTime: "2026-08-30T08:00:00",
        endorsement: {
          value: "Certified",
          certifiedBy: "certifier@example.com",
        },
        sensitivity: { labelId: "label-guid" },
        tags: [{ id: "tag-guid" }],
      },
    };

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.items[0]).toMatchObject({
      configuredBy: "builder@example.com",
      modifiedBy: "editor@example.com",
      endorsement: "certified",
      endorsementBy: "certifier@example.com",
      sensitivityLabelId: "label-guid",
      tagIds: ["tag-guid"],
      ownerMetadataAvailable: false,
      sensitivityMetadataAvailable: true,
      endorsementMetadataAvailable: true,
      tagMetadataAvailable: true,
      updatedAt: "2026-08-30T08:00:00.000Z",
    });
    expect(atlas.items[0].ownerName).toBeUndefined();
    expect(atlas.workspace).toMatchObject({
      syncedAt: "2026-08-30T09:00:00.000Z",
      syncSections: {
        workspace: { status: "complete" },
        scanner: { status: "complete" },
        metadataEndorsement: { status: "complete" },
        metadataSensitivity: { status: "complete" },
        metadataTags: { status: "complete" },
        metadataOwnership: {
          status: "complete",
          code: "type-specific",
        },
      },
    });
  });

  it("maps an explicit documented owner and preserves future endorsement values", () => {
    const raw = completeSync();
    raw.itemMetadata = {
      "item-1": {
        scannerMatched: true,
        ownerAvailable: true,
        owner: {
          principalId: "owner-id",
          displayName: "Owner Name",
          email: "owner@example.com",
          source: "workspaceInfo.configuredBy",
        },
        endorsement: {
          value: "NewFutureStatus",
        },
      },
    };
    raw.capabilities = {
      endorsement: { status: "complete" },
      sensitivity: { status: "complete", code: "label-ids" },
      tags: { status: "complete", code: "tag-ids" },
      ownership: { status: "complete", code: "type-specific" },
    };

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.items[0]).toMatchObject({
      ownerName: "Owner Name",
      ownerEmail: "owner@example.com",
      ownerMetadataAvailable: true,
      endorsement: "none",
      endorsementRaw: "NewFutureStatus",
    });
  });

  it("uses stable principal IDs and models tenant-wide item access", () => {
    const raw = completeSync();
    raw.roleAssignments = [
      {
        role: "Admin",
        principal: {
          id: "principal-1",
          displayName: "Administrator",
          type: "User",
        },
      },
    ];
    raw.access = [
      {
        itemId: "item-1",
        principalId: "principal-1",
        principalName: "Administrator",
        principalType: "User",
        accessRight: "ReadWrite",
      },
      {
        itemId: "item-1",
        principalId: "entire-tenant",
        principalName: "EntireTenant",
        userType: "EntireTenant",
        tenantWide: true,
        accessRight: "Read",
      },
    ];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: "principal-1",
          displayName: "Administrator",
        }),
        expect.objectContaining({
          principalId: "entire-tenant",
          displayName: "Entire tenant",
          kind: "group",
        }),
      ]),
    );
    expect(atlas.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalRef: "principal-1",
          source: "workspaceRole",
        }),
        expect.objectContaining({
          principalRef: "principal-1",
          itemFabricId: "item-1",
        }),
        expect.objectContaining({
          principalRef: "entire-tenant",
          flag: "broad",
        }),
      ]),
    );
  });

  it("correlates legacy item access with role-assignment principals", () => {
    const raw = completeSync();
    raw.roleAssignments = [
      {
        role: "Member",
        principal: {
          id: "principal-legacy",
          displayName: "Legacy User",
          type: "User",
          userDetails: {
            userPrincipalName: "legacy@example.com",
          },
        },
      },
    ];
    raw.access = [
      {
        itemId: "item-1",
        principalName: "Legacy User",
        principalEmail: "legacy@example.com",
        principalType: "User",
        accessRight: "Read",
      },
    ];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.principals).toHaveLength(1);
    expect(atlas.grants.map((grant) => grant.principalRef)).toEqual([
      "principal-legacy",
      "principal-legacy",
    ]);
  });

  it("canonicalizes equivalent principal UUIDs across APIs", () => {
    const raw = completeSync();
    raw.roleAssignments = [
      {
        role: "Member",
        principal: {
          id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          displayName: "Canonical User",
          type: "User",
        },
      },
    ];
    raw.access = [
      {
        itemId: "item-1",
        principalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        principalName: "Canonical User",
        principalType: "User",
        accessRight: "Read",
      },
    ];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.principals).toHaveLength(1);
    expect(atlas.principals[0].principalId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(new Set(atlas.grants.map((grant) => grant.principalRef))).toEqual(
      new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
    );
  });

  it("keeps an explicit item principal ID authoritative over a matching name", () => {
    const raw = completeSync();
    raw.roleAssignments = [
      {
        role: "Member",
        principal: {
          id: "workspace-principal",
          displayName: "Shared name",
          type: "User",
        },
      },
    ];
    raw.access = [
      {
        itemId: "item-1",
        principalId: "item-principal",
        principalName: "Shared name",
        principalType: "User",
        accessRight: "Read",
      },
    ];

    const atlas = mapSyncToAtlas(raw, {
      fabricId: workspaceId,
      displayName: "Atlas",
      capacity: "",
      region: "",
    });

    expect(atlas.principals.map((principal) => principal.principalId)).toEqual(
      ["workspace-principal", "item-principal"],
    );
    expect(
      atlas.grants.find((grant) => grant.itemFabricId === "item-1"),
    ).toMatchObject({ principalRef: "item-principal" });
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
