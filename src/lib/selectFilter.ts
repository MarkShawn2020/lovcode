export const SELECT_FILTER_THRESHOLD = 10;

export function shouldEnableSelectFilter(
  optionCount: number,
  threshold = SELECT_FILTER_THRESHOLD,
) {
  return optionCount > threshold;
}

export function selectOptionMatches(searchText: string, query: string) {
  const candidate = searchText.normalize("NFKC").toLocaleLowerCase();
  const terms = query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return terms.every((term) => candidate.includes(term));
}
