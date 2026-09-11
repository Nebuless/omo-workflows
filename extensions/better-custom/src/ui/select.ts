import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { CommandContext, ProbeItem, SelectItem } from "../types.ts";

type TuiLike = { requestRender(): void };
type ThemeLike = {
  fg(name: string, value: string): string;
  bold(value: string): string;
};
type ComponentLike = {
  render(width: number): readonly string[];
  handleInput?(data: string): void;
  invalidate?(): void;
};
type CustomFactory<T> = (
  tui: TuiLike,
  theme: ThemeLike,
  keybindings: unknown,
  done: (result: T) => void,
) => ComponentLike | Promise<ComponentLike>;
type CustomUi = {
  custom<T>(
    factory: CustomFactory<T>,
    options?: Record<string, unknown>,
  ): Promise<T>;
};

/** Explicit value used inside the custom component before public null conversion. */
export const SELECT_CANCEL = Symbol("better-custom.select.cancel");
/** Backwards-compatible aliases for callers that need to identify cancellation. */
export const CANCELLED = SELECT_CANCEL;
export const CANCEL = SELECT_CANCEL;
export type SelectCancel = typeof SELECT_CANCEL;

export function isSelectCancel(value: unknown): value is SelectCancel {
  return value === SELECT_CANCEL;
}

export function normalizeSelectItems(
  items: readonly (string | SelectItem)[],
): SelectItem[] {
  return items.map((item) =>
    typeof item === "string" ? { value: item, label: item } : { ...item },
  );
}

export function matchesSelectItem(item: SelectItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [
    item.label,
    item.value,
    item.suffix,
    item.description,
    item.searchText,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalizedQuery);
}

export function filterSelectItems(
  items: readonly (string | SelectItem)[],
  query: string,
): SelectItem[] {
  return normalizeSelectItems(items).filter((item) =>
    matchesSelectItem(item, query),
  );
}

function isCancelInput(data: string): boolean {
  return (
    data === "\u0003" ||
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.ctrl("c"))
  );
}

function isBackspaceInput(data: string): boolean {
  return data === "\u007f" || data === "\b";
}

function isPrintableInput(data: string): boolean {
  return data >= " " && data !== "\u001b" && data !== "\r" && data !== "\n";
}

function visibleRange(
  cursor: number,
  count: number,
  maxVisible: number,
): { start: number; end: number } {
  const start = Math.max(
    0,
    Math.min(
      cursor - Math.floor(maxVisible / 2),
      Math.max(0, count - maxVisible),
    ),
  );
  return { start, end: Math.min(count, start + maxVisible) };
}

function customUi(ctx: CommandContext): CustomUi {
  return ctx.ui as unknown as CustomUi;
}

export async function selectOne(
  ctx: CommandContext,
  title: string,
  items: readonly (string | SelectItem)[],
  options?: { initialIndex?: number },
): Promise<string | null> {
  const normalizedItems = normalizeSelectItems(items);
  if (normalizedItems.length === 0) return null;

  const result = await customUi(ctx).custom<string | SelectCancel>(
    (tui, theme, _keybindings, done) => {
      let cursor = Math.max(
        0,
        Math.min(options?.initialIndex ?? 0, normalizedItems.length - 1),
      );
      let query = "";
      let cachedLines: readonly string[] | undefined;
      const maxVisible = 12;

      const visibleItems = () => filterSelectItems(normalizedItems, query);
      const refresh = () => {
        const visible = visibleItems();
        cursor =
          visible.length === 0 ? 0 : Math.min(cursor, visible.length - 1);
        cachedLines = undefined;
        tui.requestRender();
      };

      return {
        render(width: number): readonly string[] {
          if (cachedLines) return cachedLines;
          const visible = visibleItems();
          const safeWidth = Math.max(10, width);
          const lines: string[] = [];
          const add = (line = "") =>
            lines.push(truncateToWidth(line, safeWidth));
          const border = theme.fg("accent", "─".repeat(safeWidth));
          add(border);
          add(" " + theme.fg("accent", theme.bold(title)));
          add(" " + theme.fg("text", "Search: " + (query || "-")));
          add();

          if (visible.length === 0) {
            add(theme.fg("warning", " No matches."));
          } else {
            const range = visibleRange(cursor, visible.length, maxVisible);
            for (let i = range.start; i < range.end; i += 1) {
              const item = visible[i];
              const active = i === cursor;
              const prefix = active ? theme.fg("accent", "> ") : "  ";
              const label = active
                ? theme.fg("accent", item.label)
                : theme.fg("text", item.label);
              const suffix = item.suffix ? theme.fg("dim", item.suffix) : "";
              add(prefix + label + suffix);
              if (item.description) {
                for (const line of item.description.split("\n"))
                  add("   " + theme.fg("muted", line));
              }
            }
            if (visible.length > maxVisible) {
              add();
              add(
                theme.fg(
                  "dim",
                  " " +
                    (range.start + 1) +
                    "-" +
                    range.end +
                    " of " +
                    visible.length,
                ),
              );
            }
          }

          add();
          add(
            theme.fg(
              "dim",
              " Type to search • ↑↓ move (wraps) • enter confirm • backspace delete • esc cancel",
            ),
          );
          add(border);
          cachedLines = lines;
          return lines;
        },
        invalidate() {
          cachedLines = undefined;
        },
        handleInput(data: string) {
          if (isCancelInput(data)) {
            done(SELECT_CANCEL);
            return;
          }
          const visible = visibleItems();
          if (matchesKey(data, Key.up)) {
            if (visible.length === 0) return;
            cursor = cursor === 0 ? visible.length - 1 : cursor - 1;
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            if (visible.length === 0) return;
            cursor = cursor === visible.length - 1 ? 0 : cursor + 1;
            refresh();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            done(visible[cursor]?.value ?? SELECT_CANCEL);
            return;
          }
          if (isBackspaceInput(data)) {
            if (query.length > 0) {
              query = query.slice(0, -1);
              refresh();
            }
            return;
          }
          if (isPrintableInput(data)) {
            query += data;
            cursor = 0;
            refresh();
          }
        },
      };
    },
  );
  return isSelectCancel(result) ? null : result;
}

export async function pickMany(
  ctx: CommandContext,
  title: string,
  items: readonly ProbeItem[],
): Promise<string[] | null> {
  const normalizedItems = normalizeSelectItems(items);
  if (normalizedItems.length === 0) return null;

  const result = await customUi(ctx).custom<string[] | SelectCancel>(
    (tui, theme, _keybindings, done) => {
      let cursor = 0;
      let query = "";
      const selected = new Set<string>();
      let cachedLines: readonly string[] | undefined;
      const maxVisible = 12;

      const visibleItems = () => filterSelectItems(normalizedItems, query);
      const refresh = () => {
        const visible = visibleItems();
        cursor =
          visible.length === 0 ? 0 : Math.min(cursor, visible.length - 1);
        cachedLines = undefined;
        tui.requestRender();
      };

      return {
        render(width: number): readonly string[] {
          if (cachedLines) return cachedLines;
          const visible = visibleItems();
          const safeWidth = Math.max(10, width);
          const lines: string[] = [];
          const add = (line = "") =>
            lines.push(truncateToWidth(line, safeWidth));
          const border = theme.fg("accent", "─".repeat(safeWidth));
          add(border);
          add(" " + theme.fg("accent", theme.bold(title)));
          add(" " + theme.fg("text", "Search: " + (query || "-")));
          add(
            " " +
              theme.fg(
                "muted",
                selected.size +
                  " selected • " +
                  visible.length +
                  "/" +
                  normalizedItems.length +
                  " shown",
              ),
          );
          add();

          if (visible.length === 0) {
            add(theme.fg("warning", " No matching models."));
          } else {
            const range = visibleRange(cursor, visible.length, maxVisible);
            for (let i = range.start; i < range.end; i += 1) {
              const item = visible[i];
              const active = i === cursor;
              const checked = selected.has(item.value);
              const prefix = active ? theme.fg("accent", "> ") : "  ";
              const box = checked
                ? theme.fg("success", "[x]")
                : theme.fg("muted", "[]");
              const label = active
                ? theme.fg("accent", item.label)
                : theme.fg("text", item.label);
              const desc = item.description
                ? " " +
                  theme.fg("muted", item.description.replace(/\s*\n\s*/g, " "))
                : "";
              add(prefix + box + " " + label + desc);
            }
            if (visible.length > maxVisible) {
              add();
              add(
                theme.fg(
                  "dim",
                  " " +
                    (range.start + 1) +
                    "-" +
                    range.end +
                    " of " +
                    visible.length,
                ),
              );
            }
          }

          add();
          add(
            theme.fg(
              "dim",
              " Type to search • ↑↓ move (wraps) • space toggle • enter confirm • backspace delete • esc cancel",
            ),
          );
          if (selected.size === 0)
            add(
              theme.fg(
                "warning",
                " Select at least one model before confirming.",
              ),
            );
          add(border);
          cachedLines = lines;
          return lines;
        },
        invalidate() {
          cachedLines = undefined;
        },
        handleInput(data: string) {
          if (isCancelInput(data)) {
            done(SELECT_CANCEL);
            return;
          }
          const visible = visibleItems();
          if (matchesKey(data, Key.up)) {
            if (visible.length === 0) return;
            cursor = cursor === 0 ? visible.length - 1 : cursor - 1;
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            if (visible.length === 0) return;
            cursor = cursor === visible.length - 1 ? 0 : cursor + 1;
            refresh();
            return;
          }
          if (matchesKey(data, Key.space)) {
            const value = visible[cursor]?.value;
            if (value !== undefined) {
              if (selected.has(value)) selected.delete(value);
              else selected.add(value);
            }
            refresh();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            if (selected.size > 0) done(Array.from(selected));
            return;
          }
          if (isBackspaceInput(data)) {
            if (query.length > 0) {
              query = query.slice(0, -1);
              refresh();
            }
            return;
          }
          if (isPrintableInput(data)) {
            query += data;
            cursor = 0;
            refresh();
          }
        },
      };
    },
  );
  return isSelectCancel(result) ? null : result;
}
