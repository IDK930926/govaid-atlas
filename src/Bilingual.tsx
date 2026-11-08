import type {BilingualCopy} from "./ui-copy";

/** Inline, left-to-right hierarchy for UI copy; never duplicates dynamic content. */
export function Bilingual({zh, en}: BilingualCopy) {
  return <span className="bilingual"><span className="bi-zh" lang="zh-Hant">{zh}</span><span className="bi-en" lang="en">{en}</span></span>;
}
