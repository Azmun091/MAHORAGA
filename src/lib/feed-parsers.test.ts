import { describe, expect, it } from "vitest";
import {
  extractExplicitTickers,
  hasPressWireKeyword,
  parseRssOrAtomItems,
  parseSitemapUrls,
} from "./feed-parsers";

const BLACKLIST = new Set(["CEO", "IPO", "SEC", "FDA", "USD", "ETF"]);

describe("extractExplicitTickers", () => {
  it("extracts (NYSE: XYZ) and (NASDAQ: ABCD)", () => {
    const text = "Company (NYSE: XYZ) and (NASDAQ: ABCD) report earnings.";
    expect(extractExplicitTickers(text, BLACKLIST).sort()).toEqual(["ABCD", "XYZ"]);
  });

  it("extracts $TICK cashtags", () => {
    const text = "Watch $AAPL and $TSLA today.";
    expect(extractExplicitTickers(text, BLACKLIST).sort()).toEqual(["AAPL", "TSLA"]);
  });

  it("excludes blacklisted tickers", () => {
    const text = "CEO said (NYSE: CEO) and $IPO.";
    expect(extractExplicitTickers(text, BLACKLIST)).toEqual([]);
  });

  it("returns empty for no tickers", () => {
    expect(extractExplicitTickers("No tickers here.", BLACKLIST)).toEqual([]);
  });
});

describe("parseRssOrAtomItems", () => {
  it("parses Atom-style entries", () => {
    const xml = `
      <feed>
        <entry>
          <id>urn:1</id>
          <title>Test</title>
          <link>https://example.com/1</link>
          <updated>2024-01-15T12:00:00Z</updated>
          <summary>Summary text</summary>
        </entry>
      </feed>
    `;
    const items = parseRssOrAtomItems(xml);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item).toBeDefined();
    expect(item!.id).toBe("urn:1");
    expect(item!.title).toBe("Test");
    expect(item!.link).toBe("https://example.com/1");
    expect(item!.published).toBe("2024-01-15T12:00:00Z");
    expect(item!.description).toBe("Summary text");
  });

  it("parses RSS-style items", () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <guid>guid-1</guid>
            <title>RSS Item</title>
            <link>https://example.com/rss1</link>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <description>Desc</description>
          </item>
        </channel>
      </rss>
    `;
    const items = parseRssOrAtomItems(xml);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item).toBeDefined();
    expect(item!.id).toBe("guid-1");
    expect(item!.title).toBe("RSS Item");
    expect(item!.published).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("returns empty array for no entries", () => {
    expect(parseRssOrAtomItems("<feed></feed>")).toEqual([]);
  });
});

describe("parseSitemapUrls", () => {
  it("parses sitemap url entries", () => {
    const xml = `
      <urlset>
        <url>
          <loc>https://example.com/page1</loc>
          <lastmod>2024-01-15</lastmod>
        </url>
        <url>
          <loc>https://example.com/page2</loc>
        </url>
      </urlset>
    `;
    const urls = parseSitemapUrls(xml);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBeDefined();
    expect(urls[1]).toBeDefined();
    expect(urls[0]!).toEqual({ loc: "https://example.com/page1", lastmod: "2024-01-15" });
    expect(urls[1]!).toEqual({ loc: "https://example.com/page2", lastmod: "" });
  });

  it("returns empty array for no urls", () => {
    expect(parseSitemapUrls("<urlset></urlset>")).toEqual([]);
  });
});

describe("hasPressWireKeyword", () => {
  it("returns true for earnings", () => {
    expect(hasPressWireKeyword("Company reports earnings beat")).toBe(true);
  });

  it("returns true for merger, FDA, guidance", () => {
    expect(hasPressWireKeyword("Merger announced")).toBe(true);
    expect(hasPressWireKeyword("FDA approval")).toBe(true);
    expect(hasPressWireKeyword("Raises guidance")).toBe(true);
  });

  it("returns false for generic text", () => {
    expect(hasPressWireKeyword("The weather is nice")).toBe(false);
  });
});
