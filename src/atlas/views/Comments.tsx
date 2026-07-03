import { useMemo, useState } from "react";
import { Send, MessageSquare } from "lucide-react";
import { useAtlas } from "../store";
import { Avatar, Card, TypeGlyph } from "../ui";
import { relativeTime, type Comment, type Item } from "../model";

export function CommentsView() {
  const { data, addComment, currentUser } = useAtlas();
  const { comments, items } = data;

  const [text, setText] = useState("");
  const [target, setTarget] = useState<string>("");
  const [posting, setPosting] = useState(false);

  const itemById = useMemo(
    () => new Map<string, Item>(items.map((i) => [i.fabricId, i])),
    [items],
  );

  const feed = useMemo(
    () => [...comments].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [comments],
  );

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    try {
      await addComment(text, target || undefined);
      setText("");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="text-[22px] font-bold">Comments</h1>
        <div className="mt-[4px] text-[13px] text-muted-foreground">
          Team notes on the workspace and its items — stored in the Fabric-backed database, so
          they persist and everyone sees them
        </div>
      </div>

      <Card style={{ padding: 16 }}>
        <div className="flex items-start gap-[12px]">
          <Avatar name={currentUser.name} size={36} />
          <div className="flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a note for the team…"
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-background px-[12px] py-[10px] text-[14px] outline-none focus:border-primary"
            />
            <div className="mt-[10px] flex items-center gap-[10px]">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="rounded-lg border border-border bg-background px-[10px] py-[7px] text-[13px] outline-none"
              >
                <option value="">Whole workspace</option>
                {items.map((i) => (
                  <option key={i.fabricId} value={i.fabricId}>
                    {i.displayName}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void post()}
                disabled={posting || !text.trim()}
                className="ml-auto flex items-center gap-[8px] rounded-lg bg-primary px-[14px] py-[8px] text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                <Send size={14} />
                Post
              </button>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-[12px]">
        {feed.map((c: Comment) => {
          const item = c.itemFabricId ? itemById.get(c.itemFabricId) : undefined;
          return (
            <Card key={c.id} style={{ padding: 16 }}>
              <div className="flex items-start gap-[12px]">
                <Avatar name={c.authorName} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <span className="text-[14px] font-bold">{c.authorName}</span>
                    {item ? (
                      <span className="inline-flex items-center gap-[6px] rounded-md bg-muted px-[8px] py-[2px] text-[11px] font-semibold text-muted-foreground">
                        <TypeGlyph type={item.itemType} size={16} />
                        {item.displayName}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-[6px] rounded-md bg-muted px-[8px] py-[2px] text-[11px] font-semibold text-muted-foreground">
                        <MessageSquare size={12} /> Workspace
                      </span>
                    )}
                    <span className="text-[12px] text-muted-foreground">
                      {relativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="mt-[6px] whitespace-pre-wrap text-[14px] leading-[1.55]">
                    {c.body}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
