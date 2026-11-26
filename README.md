# EitanGD Gacha

A fan-made Geometry Dash card-collecting (gacha) game that runs entirely in the browser. You open packs, collect level cards, sell duplicates and complete sets. It includes an **Admin** page for testing.

Inspired by [gachagd.com](https://gachagd.com) by John119 and mochamaple. This is an independent project with original code, design and generated card art. It is not affiliated with gachagd.com or RobTop Games.

## Credits
- **Geometry Dash** © RobTop Games.
- Every level belongs to its creator. Each card shows the creator's name ("by …") and a credit line in its art.
- Difficulty tiers follow the GD community lists (GDDL, AREDL).

## Features
- 5 packs (Demon, Classic, Easy & Medium, Hard & Insane, Extreme), each with its own price and rarity odds
- Rarities from Common to Mythic, plus Foil and Full art versions
- Pack opening with flip-to-reveal, bulk opening ×10 and a "God pack" callout
- Mana orbs that build up over time (collect them), a daily claim with a streak, and selling duplicates
- A collection with set tabs, search, filters and sorting; a catalog with completion % and pages; a page for each card
- **Admin (`#/admin`)**: set or add orbs, grant any card (foil or full art), add your own custom cards, edit pack prices, sizes and odds, change the economy, reset the daily claim, and export, import or wipe your save

Everything is saved in your browser (localStorage). Admin changes affect only your own browser.

## Run on GitHub Pages
1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to *Deploy from a branch*, choose the branch, set the folder to `/ (root)`, and save.
4. The site will be at `https://<your-user>.github.io/<repo-name>/`.

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000.

## Files
- `index.html`: page shell
- `css/style.css`: styles
- `js/data.js`: card list, packs, odds and economy (add levels here)
- `js/game.js`: game rules and save data
- `js/cards.js`: card rendering and generated art
- `js/ui.js`: pages (Home, Catalog, Card, Admin)
