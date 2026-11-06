// Minimal Markdown block parser for Atlas Scout answers. Output is rendered as
// React elements (never raw HTML), so agent text cannot inject markup.

export type ScoutBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; language: string; text: string };

export type ScoutInline = { kind: "text" | "strong" | "code"; text: string };

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export function parseScoutMarkdown(source: string): ScoutBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ScoutBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    const fence = /^```\s*([\w-]*)/.exec(trimmed);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[1] ?? "", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (trimmed.startsWith("|") && TABLE_SEPARATOR.test(lines[index + 1]?.trim() ?? "")) {
      flushParagraph();
      const header = tableCells(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = !item[1];
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "list" && previous.ordered === ordered) {
        previous.items.push(item[3].trim());
      } else {
        blocks.push({ kind: "list", ordered, items: [item[3].trim()] });
      }
      continue;
    }
    const previous = blocks[blocks.length - 1];
    if (!paragraph.length && previous?.kind === "list" && /^\s{2,}/.test(line)) {
      previous.items[previous.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

export type ScoutTone = "healthy" | "warning" | "failing";

export type ScoutCell =
  | { kind: "percent"; value: number; text: string }
  | { kind: "status"; tone: ScoutTone; text: string }
  | { kind: "number"; text: string }
  | { kind: "text"; text: string };

const STATUS_TONES: Record<string, ScoutTone> = {
  failed: "failing",
  failing: "failing",
  critical: "failing",
  error: "failing",
  high: "failing",
  blocked: "failing",
  warning: "warning",
  medium: "warning",
  stale: "warning",
  partial: "warning",
  unknown: "warning",
  pending: "warning",
  healthy: "healthy",
  succeeded: "healthy",
  success: "healthy",
  completed: "healthy",
  ok: "healthy",
  low: "healthy",
  pass: "healthy",
  passed: "healthy",
  certified: "healthy",
  promoted: "healthy",
};

/** Classifies a table cell so the view can render gauges, pills and numbers. */
export function classifyScoutCell(raw: string): ScoutCell {
  const text = raw.replace(/\*\*/g, "").trim();
  const percent = /^(-?\d+(?:[.,]\d+)?)\s?%$/.exec(text);
  if (percent) {
    const value = Math.max(0, Math.min(100, Number(percent[1].replace(",", "."))));
    return { kind: "percent", value, text };
  }
  const tone = STATUS_TONES[text.toLowerCase()];
  if (tone) return { kind: "status", tone, text };
  if (/^-?\d[\d\s,.]*$/.test(text)) return { kind: "number", text };
  return { kind: "text", text: raw };
}

export type SqlToken = { kind: "keyword" | "string" | "number" | "comment" | "text"; text: string };

const SQL_KEYWORDS = new Set(
  (
    "select from where and or not in is null as join left right inner outer full cross on group by order " +
    "having top distinct count sum avg min max case when then else end with union all desc asc like between " +
    "exists cast convert coalesce isnull over partition row_number limit offset fetch next rows only"
  ).split(" "),
);

/** Splits SQL into tokens for lightweight, markup-free syntax highlighting. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const pattern = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|([\s\S])/g;
  for (const match of sql.matchAll(pattern)) {
    const [text, comment, string, number, word] = match;
    const kind: SqlToken["kind"] = comment
      ? "comment"
      : string
        ? "string"
        : number
          ? "number"
          : word && SQL_KEYWORDS.has(word.toLowerCase())
            ? "keyword"
            : "text";
    const previous = tokens[tokens.length - 1];
    if (kind === "text" && previous?.kind === "text") previous.text += text;
    else tokens.push({ kind, text });
  }
  return tokens;
}

export function parseScoutInline(text: string): ScoutInline[] {
  const parts: ScoutInline[] = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    if (match[3] !== undefined) parts.push({ kind: "code", text: match[3] });
    else parts.push({ kind: "strong", text: match[1] ?? match[2] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
