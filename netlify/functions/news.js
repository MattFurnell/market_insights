import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { readFileSync } from "fs";

const sourcesCfg = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "InsightsDashboardBot/1.0 (+Netlify Function)" }
});

const CACHE_TTL_MS = 10 * 60 * 1000;
let CACHE = { ts: 0, payload: null };

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "InsightsDashboardBot/1.0 (+Netlify Function)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// --------------------
// DATE HANDLING
// --------------------

function cleanDateString(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;

  return dateStr
    .replace(/\s+/g, " ")
    .replace(/(\d{1,2})(st|nd|rd|th)/gi, "$1")
    .replace(/^published[:\s-]*/i, "")
    .replace(/^updated[:\s-]*/i, "")
    .trim();
}

function parseSafeDate(dateInput) {
  if (!dateInput) return null;

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return dateInput.toISOString();
  }

  if (typeof dateInput === "number") {
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  const cleaned = cleanDateString(String(dateInput));
  if (!cleaned) return null;

  let parsed = new Date(cleaned);

  if (isNaN(parsed.getTime())) {
    const ukMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

    if (ukMatch) {
      const [, day, month, year] = ukMatch;

      parsed = new Date(
        Number(year.length === 2 ? `20${year}` : year),
        Number(month) - 1,
        Number(day)
      );
    }
  }

  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

// --------------------
// CORE HELPERS
// --------------------

function normaliseItem({
  title,
  url,
  summary,
  publishedAt,
  source,
  category
}) {
  return {
    id: (url || `${source}-${title}`).toLowerCase(),
    title: (title || "").trim(),
    url,
    source,
    summary: (summary || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320),
    publishedAt: parseSafeDate(publishedAt),
    category
  };
}

function dedupe(items) {
  const seen = new Set();

  return items.filter((it) => {
    const key = `${(it.url || "").toLowerCase()}|${(it.title || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --------------------
// CATEGORIES
// --------------------

function classify(defaultCategory, title, summary) {
  const text = `${title} ${summary}`.toLowerCase();

  const has = (...words) => words.some((w) => text.includes(w));

  if (has("student", "university", "maintenance loan", "freshers")) return "Student";
  if (has("farm", "farming", "rural", "agri", "livestock")) return "Rural";
  if (has("motor", "car", "van", "driver", "fleet", "ev", "theft")) return "Motor";
  if (has("home", "property", "buildings", "contents", "flood", "subsidence")) return "Home";
  if (has("life insurance", "income protection", "health", "medical", "nhs")) return "Life & Health";
  if (has("broker", "underwriting", "lloyd", "reinsurance", "claims", "fca", "pra", "abi", "biba", "hiscox")) return "Trade";

  return defaultCategory || "Business";
}

// --------------------
// SCRAPER ENGINE
// --------------------

async function scrapeGenericArticles({ listUrl, sourceName, category, hostname, match }) {
  const html = await fetchText(listUrl, 9000);
  const $ = cheerio.load(html);

  const articleUrls = new Set();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    let u;
    try {
      u = new URL(href, listUrl);
    } catch {
      return;
    }

    u.hash = "";

    if (hostname && u.hostname !== hostname) return;
    if (!match(u.pathname)) return;

    articleUrls.add(u.toString());
  });

  const urls = Array.from(articleUrls).slice(0, 25);
  const items = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url, 9000);
      const $$ = cheerio.load(html);

      const title =
        $$("meta[property='og:title']").attr("content") ||
        $$("h1").first().text() ||
        $$("title").text();

      const description =
        $$("meta[name='description']").attr("content") ||
        $$("meta[property='og:description']").attr("content") ||
        $$("p").first().text() ||
        "";

      const publishedAt =
        $$("meta[property='article:published_time']").attr("content") ||
        $$("time").first().attr("datetime") ||
        $$("time").first().text() ||
        null;

      const item = normaliseItem({
        title,
        url,
        summary: description,
        publishedAt,
        source: sourceName,
        category
      });

      if (item.title && item.url) {
        items.push(item);
      }
    } catch (err) {
      console.warn(`Scrape failed: ${url}`, err.message);
    }
  }

  return items;
}

// --------------------
// SCRAPER REGISTRY
// --------------------

const SCRAPERS = {
  "https://www.hiscoxgroup.com/news/press-releases": {
    hostname: "www.hiscoxgroup.com",
    sourceName: "Hiscox Group - Press Releases",
    category: "Trade",

    match(pathname) {
      const cleanPath = pathname.replace(/\/$/, "");
      const parts = cleanPath.split("/").filter(Boolean);

      return (
        parts.length >= 3 &&
        parts[0] === "news" &&
        parts[1] === "press-releases"
      );
    }
  },

  "https://www.simplybusiness.co.uk/about-us/press-releases/": {
    hostname: "www.simplybusiness.co.uk",
    sourceName: "Simply Business - Press Releases",
    category: "Trade",

    // Matches individual press release articles, e.g.:
    //   /about-us/press-releases/2024/01/some-article-slug/
    // Excludes the listing page itself (/about-us/press-releases/ alone).
    match(pathname) {
      const cleanPath = pathname.replace(/\/$/, "");
      const parts = cleanPath.split("/").filter(Boolean);

      return (
        parts.length >= 3 &&
        parts[0] === "about-us" &&
        parts[1] === "press-releases"
      );
    }
  }
};

// --------------------
// MAIN HANDLER
// --------------------

export const handler = async () => {
  const now = Date.now();

  if (CACHE.payload && now - CACHE.ts < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ...CACHE.payload, cached: true })
    };
  }

  const diagnostics = [];
  const allItems = [];

  for (const source of sourcesCfg.sources || []) {
    const t0 = Date.now();

    try {
      if (source.sourceType === "scraped" && source.siteUrl) {
        const scraper = SCRAPERS[source.siteUrl];

        if (!scraper) {
          throw new Error(`No scraper configured for ${source.siteUrl}`);
        }

        const scraped = await scrapeGenericArticles({
          listUrl: source.siteUrl,
          sourceName: scraper.sourceName,
          category: scraper.category,
          hostname: scraper.hostname,
          match: scraper.match
        });

        for (const it of scraped) {
          it.category = classify(source.defaultCategory, it.title, it.summary);
          allItems.push(it);
        }

        diagnostics.push({
          source: source.name,
          ok: true,
          kind: "scraped",
          ms: Date.now() - t0,
          items: scraped.length
        });

        continue;
      }

      if (source.feedUrl) {
        const xml = await fetchText(source.feedUrl, 9000);
        const feed = await parser.parseString(xml);

        const items = (feed.items || []).slice(0, 25);
        let kept = 0;

        for (const item of items) {
          const title = item.title || "";
          const url = item.link || "";

          const publishedAt =
            item.isoDate ||
            item.pubDate ||
            item.published ||
            item.created ||
            null;

          const summary =
            item.contentSnippet ||
            item.summary ||
            item.content ||
            "";

          if (!title || !url) continue;

          allItems.push(
            normaliseItem({
              title,
              url,
              summary,
              publishedAt,
              source: source.name,
              category: classify(source.defaultCategory, title, summary)
            })
          );

          kept++;
        }

        diagnostics.push({
          source: source.name,
          ok: true,
          kind: "rss",
          ms: Date.now() - t0,
          items: kept
        });

        continue;
      }

      diagnostics.push({
        source: source.name,
        ok: false,
        ms: Date.now() - t0,
        error: "No feedUrl or supported scraper"
      });
    } catch (err) {
      diagnostics.push({
        source: source.name,
        ok: false,
        ms: Date.now() - t0,
        error: err.message
      });
    }
  }

  const cleaned = dedupe(allItems).sort((a, b) => {
    const da = Date.parse(a.publishedAt || "") || 0;
    const db = Date.parse(b.publishedAt || "") || 0;
    return db - da;
  });

  const payload = {
    items: cleaned,
    diagnostics,
    cached: false
  };

  CACHE = { ts: Date.now(), payload };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  };
};
