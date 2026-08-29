import { getRayfinClient } from "@/lib/rayfin-client";

export type AccessReviewStatus = "reviewed" | "accepted" | "needsAction";

export interface AccessReviewDecision {
  id: string;
  rowKey: string;
  itemFabricId: string;
  principalRef: string;
  status: AccessReviewStatus;
  note?: string;
  reviewedAt: string;
  updatedAt: string;
}

interface ReviewRow {
  id: string;
  workspace_id: string;
  user_id: string;
  recordKey: string;
  rowKey: string;
  itemFabricId: string;
  principalRef: string;
  status: AccessReviewStatus;
  note?: string;
  reviewedAt: string | Date;
  updatedAt: string | Date;
}

interface Query {
  where(filter: Record<string, unknown>): Query;
  orderBy(order: Record<string, "asc" | "desc">): Query;
  execute(): Promise<ReviewRow[]>;
}

interface Api {
  select(fields: readonly string[]): Query;
  create(value: Record<string, unknown>): Promise<ReviewRow>;
  update(
    filter: Record<string, unknown>,
    value: Record<string, unknown>,
  ): Promise<unknown>;
  delete(filter: Record<string, unknown>): Promise<unknown>;
}

const FIELDS = [
  "id",
  "workspace_id",
  "user_id",
  "recordKey",
  "rowKey",
  "itemFabricId",
  "principalRef",
  "status",
  "note",
  "reviewedAt",
  "updatedAt",
] as const;

function api(): Api {
  return (
    getRayfinClient().data as unknown as { AccessReview: Api }
  ).AccessReview;
}

function parse(row: ReviewRow): AccessReviewDecision {
  return {
    id: String(row.id),
    rowKey: String(row.rowKey),
    itemFabricId: String(row.itemFabricId),
    principalRef: String(row.principalRef),
    status: row.status,
    note: row.note ? String(row.note) : undefined,
    reviewedAt: new Date(row.reviewedAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function reviewRecordKey(
  workspaceId: string,
  userId: string,
  rowKey: string,
): string {
  const key = [workspaceId, userId, rowKey]
    .map((value) => encodeURIComponent(value))
    .join("|");
  if (key.length > 450) {
    throw new Error("Access review identity is too large to persist.");
  }
  return key;
}

async function findExisting(recordKey: string): Promise<ReviewRow | undefined> {
  const rows = await api()
    .select(FIELDS)
    .where({ recordKey: { eq: recordKey } })
    .orderBy({ reviewedAt: "desc" })
    .execute();
  return rows[0];
}

export async function loadAccessReviews(
  isPreview: boolean,
  workspaceId: string,
  userId: string,
): Promise<AccessReviewDecision[]> {
  if (isPreview) return [];
  const rows = await api()
    .select(FIELDS)
    .where({
      workspace_id: { eq: workspaceId },
      user_id: { eq: userId },
    })
    .orderBy({ reviewedAt: "desc" })
    .execute();
  const decisions: AccessReviewDecision[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.rowKey)) continue;
    seen.add(row.rowKey);
    decisions.push(parse(row));
  }
  return decisions;
}

export async function saveAccessReview(
  isPreview: boolean,
  workspaceId: string,
  userId: string,
  input: {
    current?: AccessReviewDecision;
    rowKey: string;
    itemFabricId: string;
    principalRef: string;
    status: AccessReviewStatus;
    note?: string;
  },
): Promise<AccessReviewDecision> {
  const now = new Date();
  const recordKey = reviewRecordKey(workspaceId, userId, input.rowKey);
  const row: ReviewRow = {
    id: input.current?.id ?? crypto.randomUUID(),
    workspace_id: workspaceId,
    user_id: userId,
    recordKey,
    rowKey: input.rowKey,
    itemFabricId: input.itemFabricId,
    principalRef: input.principalRef,
    status: input.status,
    note: input.note?.trim() || undefined,
    reviewedAt: now,
    updatedAt: now,
  };
  if (isPreview) return parse(row);
  const existing = input.current
    ? ({
        ...row,
        id: input.current.id,
      } as ReviewRow)
    : await findExisting(recordKey);
  if (existing) {
    await api().update(
      { id: existing.id },
      {
        status: row.status,
        note: row.note,
        reviewedAt: now,
        updatedAt: now,
      },
    );
    return parse({ ...row, id: existing.id });
  }
  try {
    return parse(
      await api().create({
        workspace_id: workspaceId,
        user_id: userId,
        recordKey,
        rowKey: row.rowKey,
        itemFabricId: row.itemFabricId,
        principalRef: row.principalRef,
        status: row.status,
        note: row.note,
        reviewedAt: now,
        updatedAt: now,
      }),
    );
  } catch (error) {
    const concurrent = await findExisting(recordKey);
    if (!concurrent) throw error;
    await api().update(
      { id: concurrent.id },
      {
        status: row.status,
        note: row.note,
        reviewedAt: now,
        updatedAt: now,
      },
    );
    return parse({ ...row, id: concurrent.id });
  }
}

export async function deleteAccessReview(
  isPreview: boolean,
  id: string,
): Promise<void> {
  if (isPreview) return;
  await api().delete({ id });
}
