// A filter on the choices of a long picker (C382 batch 4): the project and assignee pickers of the board. Plain text or
// a regex, remembered per viewer. The picker's choices load in full (no pages), so the filter reads all of them and the
// bar says so. A filter always shows "Showing N of M" and Clear. The chosen value stays in the list even when the
// filter hides it, so typing never changes the choice. A single choice: there is no "select all".
import { accessFilter, type FilterNoun, ListFilter, type SelectOption, useAccessFilter } from "@opt2-tealbrick/ui";
import type { ReactNode } from "react";

/** A list shorter than this shows no filter bar, unless a remembered filter is on. */
export const FILTER_FROM = 8;

/** What this browser remembers is per app (the base path of the app) and per screen. */
export const filterKey = (page: string) => {
  try {
    return `tb-filter:${new URL(document.baseURI).pathname}:${page}`;
  } catch {
    return `tb-filter:${page}`;
  }
};

/**
 * `options` are the choices that may be filtered (leave fixed choices such as "All projects" out and add them after);
 * `chosen` is the value now picked. Returns the options to offer and the bar to draw above the picker (null for a short list).
 */
export function useChoiceFilter(page: string, options: readonly SelectOption[], chosen: string, label: string, noun: FilterNoun): { options: SelectOption[]; bar: ReactNode } {
  const [query, setQuery] = useAccessFilter(filterKey(page));
  const filter = accessFilter(query);
  // the name alone (so ^ and $ work on it), or the name with its note such as "team"
  const passing = options.filter((o) => (/[\^$]|\(\?/u.test(query) ? filter.test(o.label) : filter.test(o.meta !== undefined ? `${o.label} ${o.meta}` : o.label)));
  const on = query.trim() !== "";
  const bar =
    options.length >= FILTER_FROM || on ? (
      <ListFilter label={label} value={query} onChange={setQuery} filter={filter} noun={noun} shown={passing.length} total={options.length} onClear={() => setQuery("")} />
    ) : null;
  return { options: options.filter((o) => passing.includes(o) || o.value === chosen), bar };
}
