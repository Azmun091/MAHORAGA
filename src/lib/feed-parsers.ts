/**
 * Pure parsing helpers for RSS/Atom feeds and press wire text.
 * Used by mahoraga-harness gatherers; unit-tested here.
 */

function extractXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match ? (match[1] ?? null) : null;
}

export interface RssOrAtomItem {
  id: string;
  title: string;
  link: string;
  description: string;
  published: string;
}

export function parseRssOrAtomItems(xml: string): RssOrAtomItem[] {
  const items: RssOrAtomItem[] = [];
  const entryRegex = /<(?:entry|item)>([\s\S]*?)<\/(?:entry|item)>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    if (!block) continue;
    const id =
      extractXmlTag(block, "id") ??
      extractXmlTag(block, "guid") ??
      extractXmlTag(block, "link") ??
      `pr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const title = extractXmlTag(block, "title") ?? "";
    const link = extractXmlTag(block, "link") ?? "";
    const desc =
      extractXmlTag(block, "summary") ??
      extractXmlTag(block, "description") ??
      extractXmlTag(block, "content") ??
      "";
    const published =
      extractXmlTag(block, "updated") ??
      extractXmlTag(block, "published") ??
      extractXmlTag(block, "pubDate") ??
      extractXmlTag(block, "dc:date") ??
      new Date().toISOString();
    items.push({ id, title, link, description: desc, published });
  }
  return items;
}

/**
 * Extract explicit tickers from PR/news text: (NYSE: XYZ), (NASDAQ: ABCD), $TICK.
 * Blacklist set should contain common words to avoid false positives (e.g. CEO, IPO).
 */
export function extractExplicitTickers(text: string, blacklist: Set<string>): string[] {
  const tickers = new Set<string>();
  const nyseNasdaq = /\((?:NYSE|NASDAQ|AMEX|ARCA)\s*:\s*([A-Z]{1,5})\)/gi;
  let m: RegExpExecArray | null;
  while ((m = nyseNasdaq.exec(text)) !== null) {
    const t = (m[1] ?? "").toUpperCase();
    if (t.length >= 1 && t.length <= 5 && !blacklist.has(t)) tickers.add(t);
  }
  const cashtag = /\$([A-Z]{1,5})\b/g;
  while ((m = cashtag.exec(text)) !== null) {
    const t = (m[1] ?? "").toUpperCase();
    if (t.length >= 2 && t.length <= 5 && !blacklist.has(t)) tickers.add(t);
  }
  return Array.from(tickers);
}

export interface SitemapUrl {
  loc: string;
  lastmod: string;
}

export function parseSitemapUrls(xml: string): SitemapUrl[] {
  const urls: SitemapUrl[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    if (!block) continue;
    const loc = extractXmlTag(block, "loc") ?? "";
    const lastmod = extractXmlTag(block, "lastmod") ?? "";
    if (loc) urls.push({ loc, lastmod });
  }
  return urls;
}

/** Check if text contains high-signal press wire keywords. */
export const PRESS_WIRE_KEYWORDS =
  /earnings|guidance|merger|acquisition|fda|approval|contract|investigation|bankruptcy|offering|buyback|dividend|revenue|beat|miss|raises|cuts/i;

export function hasPressWireKeyword(text: string): boolean {
  return PRESS_WIRE_KEYWORDS.test(text);
}
