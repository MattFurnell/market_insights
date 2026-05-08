import Parser from "rss-parser";
import * as cheerio from "cheerio";
import sourcesCfg from "./sources.json" assert { type: "json" };

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "InsightsDashboardBot/2.0" }
});

// 🔥 Increased cache to 60 mins
const CACHE_TTL_MS = 60 * 60 * 1000;
let CACHE = { ts: 0, payload: null };

// --------------------
// FETCH
// --------------------

async function fetchText(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// --------------------
// PARALLEL LIMITER
// --------------------

async function mapLimit(items, limit, fn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    executing.add(p);

    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

// --------------------
// DATE
// --------------------

function parseSafeDate(input) {
  if (!input) return new Date().toISOString();

  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// --------------------
// CLASSIFICATION
// --------------------

function classify(defaultCategory, title, summary) {
  const text = `${title} ${summary}`.toLowerCase();

  if (text.includes("motor") || text.includes("car")) return "Motor";
  if (text.includes("home") || text.includes("property")) return "Home";
  if (text.includes("health") || text.includes("nhs")) return "Life & Health";
  if (text.includes("farm") || text.includes("rural")) return "Rural";
  if (text.includes("broker") || text.includes("fca")) return "Trade";

  return defaultCategory || "Business";
}

// --------------------
// MARKETING INSIGHT LAYER
// --------------------

function enrichMarketing(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();

  if (text.includes("small business") || text.includes("sme")) {
    return {
      audience: "SMEs",
      urgency: "High",
      contentIdeas: [
        "What this means for UK SMEs",
        "Insurance implications for small businesses"
      ]
    };
  }

  return {
    audience: "General",
    urgency: "Medium",
    contentIdeas: ["Industry insight summary"]
  };
}

// --------------------
// NORMALISE
// --------------------

function normaliseItem(item) {
  const marketing = enrichMarketing(item.title, item.summary);

  return {
    id: item.url,
    ...item,
    ...marketing,
    publishedAt: parseSafeDate(item.publishedAt)
  };
}

// --------------------
// GENERIC SCRAPER
// --------------------

async function scrapeGeneric(source) {
  const html = await fetchText(source.siteUrl);
  const $ = cheerio.load(html);

  const links = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const url = new URL(href, source.siteUrl);

      if (source.hostname && url.hostname !== source.hostname) return;

      if (
        source.pathIncludes &&
        !source.pathIncludes.some((p) => url.pathname.includes(p))
      )
        return;

      links.add(url.toString());
    } catch {}
  });

  const urls = Array.from(links).slice(0, 20);

  const results = await mapLimit(urls, 5, async (url) => {
    try {
      const html = await fetchText(url);
      const $$ = cheerio.load(html);

      const title =
        $$("meta[property='og:title']").attr("content") ||
        $$("h1").first().text();

      const summary =
        $$("meta[name='description']").attr("content") || "";

      let publishedAt =
        $$("meta[property='article:published_time']").attr("content") ||
        $$("time").attr("datetime");

      // 🔧 fallback (fix for Confused.com)
      if (!publishedAt) publishedAt = new Date().toISOString();

      return normaliseItem({
        title,
        summary,
        url,
        source: source.name,
        category: source.defaultCategory,
        publishedAt
      });
    } catch {
      return null;
    }
  });

  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

// --------------------
// MAIN HANDLER
// --------------------

export const handler = async () => {
  const now = Date.now();

  if (CACHE.payload && now - CACHE.ts < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ...CACHE.payload, cached: true })
    };
  }

  const allItems = [];

  for (const source of sourcesCfg.sources) {
    try {
      // RSS
      if (source.feedUrl) {
        const xml = await fetchText(source.feedUrl);
        const feed = await parser.parseString(xml);

        for (const item of (feed.items || []).slice(0, 20)) {
          allItems.push(
            normaliseItem({
              title: item.title,
              summary: item.contentSnippet || "",
              url: item.link,
              source: source.name,
              category: classify(
                source.defaultCategory,
                item.title,
                item.contentSnippet
              ),
              publishedAt: item.isoDate || item.pubDate
            })
          );
        }
      }

      // SCRAPED
      if (source.sourceType === "scraped") {
        const scraped = await scrapeGeneric(source);
        allItems.push(...scraped);
      }
    } catch (err) {
      console.warn("Source failed:", source.name, err.message);
    }
  }

  const cleaned = allItems
    .filter((x) => x && x.title && x.url)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const payload = { items: cleaned };

  CACHE = { ts: now, payload };

  return {
    statusCode: 200,
    body: JSON.stringify(payload)
  };
};
