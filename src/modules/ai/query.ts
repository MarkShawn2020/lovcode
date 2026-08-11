import type { SearchMode } from "@/modules/sdk/search";

export interface SearchModeCopy {
  label: string;
  description: string;
}

const SEARCH_MODE_COPY: Record<SearchMode, SearchModeCopy> = {
  auto: {
    label: "自动",
    description: "由 Ataru 根据查询自动选择合适的检索方式。",
  },
  keyword: {
    label: "关键词",
    description: "匹配明确的词语、短语和技术名词。",
  },
  semantic: {
    label: "语义",
    description: "查找表达不同但含义相近的会话内容。",
  },
  hybrid: {
    label: "混合",
    description: "融合关键词与语义结果，兼顾精确度和召回率。",
  },
};

export const ATARU_QUERY_EXAMPLES: string[] = [
  "我上次是怎么解决搜索结果定位不准确的？",
  "哪次发布后遇到过索引没有更新的问题？",
  "找出讨论 Yoda 会话恢复方案的记录",
  "最近哪些项目处理过 Tauri 启动故障？",
];

export function getSearchModeCopy(mode: SearchMode): SearchModeCopy {
  return SEARCH_MODE_COPY[mode];
}
