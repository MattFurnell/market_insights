# Market Insights Dashboard (Netlify)

This is a simple internal dashboard that pulls the latest headlines from your chosen sources (RSS/Atom where available), categorises them, and displays them newest-first.

## What it does
- Fetches from each source (via RSS/Atom). If you only provide a website URL, it tries to *auto-discover* the feed link.
- Normalises items to: title, summary, date, source, category, link.
- Dedupe + sort newest-first.
- Displays items in a branded dashboard.

## How to run locally
1. Install Node.js (18+)
2. In this folder:
   - `npm install`
   - `npm run dev`
3. Open the local URL Vite prints.

## How to deploy to Netlify (go live)
1. Create a new GitHub repo and push this folder.
2. In Netlify: **Add new site** → **Import from Git** → choose the repo.
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy.
5. Your dashboard will be live at `https://<name>.netlify.app`

## Edit sources and categories
Open `sources.json`.
- If you know a direct RSS/Atom feed, put it as `feedUrl`.
- Otherwise, leave `siteUrl` and the function will try to discover the feed.
- Set `defaultCategory` to one of your tabs.

## Notes
- Some websites do not provide public feeds. Those sources will appear under `sourceErrors` in `/api/news` response.
- This dashboard shows **headlines + summaries** and links out to the original publisher.
