"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const {
  loadCounterData,
  computeTeamScore,
} = require("./model");

const OPEN_DOTA_BASE = process.env.OPEN_DOTA_BASE || "https://api.opendota.com/api";
const DAYS = Number(process.env.DAYS || 365);
const TOTAL_LIMIT = Number(process.env.LIMIT || 12000);
const PAGE_SLEEP_MS = Number(process.env.SLEEP_MS || 120);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 12);
const DETAIL_SLEEP_MS = Number(process.env.DETAIL_SLEEP_MS || 80);
const RETRIES = Number(process.env.RETRIES || 5);
const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN || "";
const OPEN_DOTA_API_KEY = process.env.OPEN_DOTA_API_KEY || "";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function withKey(url) {
  if (!OPEN_DOTA_API_KEY) return url;
  const u = new URL(url);
  u.searchParams.set("api_key", OPEN_DOTA_API_KEY);
  return u.toString();
}

async function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method: "GET",
      headers: { "User-Agent": "model-analysis/stream/1.0", Accept: "application/json" },
    };
    const req = https.request(u, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else if (res.statusCode === 429) {
          resolve({ __rate_limited: true, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0,200)}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchJsonWithRetry(url, maxRetries = RETRIES, baseDelayMs = 1000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const r = await httpGetJson(withKey(url));
      if (r && r.__rate_limited) {
        await sleep(baseDelayMs * Math.pow(2, i));
        continue;
      }
      return r;
    } catch (e) {
      if (i === maxRetries) throw e;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
}

async function fetchViaScrapeDo(url) {
  if (!SCRAPE_DO_TOKEN) return null;
  const proxied = `https://api.scrape.do?token=${encodeURIComponent(SCRAPE_DO_TOKEN)}&url=${encodeURIComponent(withKey(url))}`;
  try { return await fetchJsonWithRetry(proxied, RETRIES, 1000); } catch { return null; }
}

async function fetchHeroList() {
  // Try constants
  try {
    const constants = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/constants/heroes`, RETRIES, 1000);
    if (constants && typeof constants === "object" && !Array.isArray(constants)) {
      const list = Object.values(constants).map((h) => ({ id: Number(h.id), localized_name: h.localized_name, name: h.name }));
      if (list.length) return list;
    }
  } catch {}
  // Try via Scrape.do
  try {
    const constantsProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/constants/heroes`);
    if (constantsProxy && typeof constantsProxy === "object" && !Array.isArray(constantsProxy)) {
      const list = Object.values(constantsProxy).map((h) => ({ id: Number(h.id), localized_name: h.localized_name, name: h.name }));
      if (list.length) return list;
    }
  } catch {}
  // Fallback heroStats
  try {
    const stats = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/heroStats`, RETRIES, 1000);
    if (Array.isArray(stats) && stats.length) return stats;
  } catch {}
  try {
    const statsProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/heroStats`);
    if (Array.isArray(statsProxy) && statsProxy.length) return statsProxy;
  } catch {}
  // Fallback heroes
  try {
    const heroes = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/heroes`, RETRIES, 1000);
    if (Array.isArray(heroes) && heroes.length) return heroes.map((h) => ({ id: h.id, localized_name: h.localized_name, name: h.name }));
  } catch {}
  try {
    const heroesProxy = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/heroes`);
    if (Array.isArray(heroesProxy) && heroesProxy.length) return heroesProxy.map((h) => ({ id: h.id, localized_name: h.localized_name, name: h.name }));
  } catch {}
  throw new Error("Failed to fetch hero list");
}

function buildHeroIdToIndexMap(openDotaHeroes, modelData) {
  const nameToIndex = new Map();
  modelData.heroes.forEach((n, i) => nameToIndex.set(n.toLowerCase(), i));
  const idToIndex = new Map();
  const list = Array.isArray(openDotaHeroes) ? openDotaHeroes : [];
  for (const h of list) {
    const namesToTry = [h.localized_name, (h.localized_name || "").replace(/-/g, " ")];
    let idx = undefined;
    for (const candidate of namesToTry) {
      const k = String(candidate || "").toLowerCase();
      if (nameToIndex.has(k)) { idx = nameToIndex.get(k); break; }
    }
    if (idx === undefined) {
      const alt = (h.localized_name || "").toLowerCase().replace(/[’']/g, "").replace(/-/g, " ").replace(/ +/g, " ").trim();
      if (nameToIndex.has(alt)) idx = nameToIndex.get(alt);
    }
    if (idx !== undefined) idToIndex.set(h.id, idx);
  }
  return idToIndex;
}

async function fetchProMatchesPage(lastId) {
  const url = lastId ? `${OPEN_DOTA_BASE}/proMatches?less_than_match_id=${lastId}` : `${OPEN_DOTA_BASE}/proMatches`;
  let page = await fetchJsonWithRetry(url, RETRIES, 800);
  if (!Array.isArray(page) || page.length === 0) {
    const prox = await fetchViaScrapeDo(url);
    if (Array.isArray(prox) && prox.length > 0) page = prox; else return [];
  }
  return page;
}

async function fetchMatchDetailsThrottled(ids) {
  let index = 0;
  const results = [];
  const errors = [];
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= ids.length) break;
      const match_id = ids[i];
      try {
        let detail = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/matches/${match_id}`, RETRIES, 800);
        if (!detail || !detail.match_id) {
          const prox = await fetchViaScrapeDo(`${OPEN_DOTA_BASE}/matches/${match_id}`);
          if (prox && prox.match_id) detail = prox;
        }
        if (detail && detail.match_id) results.push(detail); else errors.push({ match_id, error: 'empty' });
      } catch (e) {
        errors.push({ match_id, error: String(e) });
      }
      if (DETAIL_SLEEP_MS) await sleep(DETAIL_SLEEP_MS);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, DETAIL_CONCURRENCY); w++) workers.push(worker());
  await Promise.all(workers);
  return { results, errors };
}

function ensureOutFiles(outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const matchesPath = path.join(outDir, "matches.csv");
  if (!fs.existsSync(matchesPath) || fs.statSync(matchesPath).size === 0) {
    fs.writeFileSync(matchesPath, "match_id,delta,max_hero_adv,radiant_win,dire_win\n", "utf8");
  }
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  if (!fs.existsSync(detailedPath) || fs.statSync(detailedPath).size === 0) {
    fs.writeFileSync(detailedPath, [
      [
        "match_id","dire_heroes","dire_base","dire_advantages_sum","dire_score",
        "radiant_heroes","radiant_base","radiant_advantages_sum","radiant_score",
        "delta","radiant_win","dire_win"
      ].join(",")
    ].join("\n") + "\n", "utf8");
  }
  const combosPath = path.join(outDir, "matches_combos.csv");
  if (!fs.existsSync(combosPath) || fs.statSync(combosPath).size === 0) {
    fs.writeFileSync(combosPath, "match_id,r_pos,r_neg,d_pos,d_neg,radiant_win\n", "utf8");
  }
}

function loadProcessedIds(matchesPath) {
  const seen = new Set();
  if (!fs.existsSync(matchesPath)) return seen;
  const lines = fs.readFileSync(matchesPath, "utf8").trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const id = lines[i].split(",")[0];
    if (id) seen.add(Number(id));
  }
  return seen;
}

async function main() {
  const outDir = path.resolve(__dirname, "../out");
  ensureOutFiles(outDir);
  const matchesPath = path.join(outDir, "matches.csv");
  const detailedPath = path.join(outDir, "matches_detailed.csv");
  const combosPath = path.join(outDir, "matches_combos.csv");

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const heroList = await fetchHeroList();
  const idToIndex = buildHeroIdToIndexMap(heroList, data);
  console.log(`[stream] hero ids mapped: ${idToIndex.size}`);

  const seen = loadProcessedIds(matchesPath);
  console.log(`[stream] already processed: ${seen.size}`);

  const cutoff = Math.floor(Date.now() / 1000) - DAYS * 86400;
  let lastId = undefined;
  let written = 0;
  let pageNo = 0;

  while (written < TOTAL_LIMIT) {
    const page = await fetchProMatchesPage(lastId);
    if (!Array.isArray(page) || page.length === 0) {
      console.log(`[stream] empty page. stopping.`);
      break;
    }
    pageNo += 1;
    const filtered = page.filter((m) => (m.start_time || 0) >= cutoff);
    if (!filtered.length) {
      console.log(`[stream] reached cutoff.`);
      break;
    }
    lastId = page[page.length - 1].match_id;
    console.log(`[stream] page=${pageNo} got=${page.length} last_id=${lastId} filtered=${filtered.length} written=${written}`);

    const ids = filtered.map((m) => m.match_id).filter((id) => !seen.has(id));
    if (!ids.length) { if (PAGE_SLEEP_MS) await sleep(PAGE_SLEEP_MS); continue; }

    const { results } = await fetchMatchDetailsThrottled(ids);
    console.log(`[stream] details fetched: results=${results.length}`);
    for (const match of results) {
      // Extract teams
      if (!Array.isArray(match.players)) continue;
      const rad = [], dir = [];
      let valid = true;
      for (const p of match.players) {
        const midx = idToIndex.get(p.hero_id);
        if (midx === undefined) { valid = false; break; }
        if (p.isRadiant) rad.push(midx); else dir.push(midx);
      }
      if (!valid || rad.length !== 5 || dir.length !== 5) continue;

      const rTeam = computeTeamScore(rad, dir, data);
      const dTeam = computeTeamScore(dir, rad, data);
      const delta = rTeam.score - dTeam.score;
      const rMax = Math.max(...rTeam.perHeroAdvantages);
      const dMax = Math.max(...dTeam.perHeroAdvantages);
      const maxHeroAdv = Math.max(rMax, dMax);
      const radiantWon = match.radiant_win === true;
      const direWon = radiantWon ? 0 : 1;

      // Append to matches.csv
      fs.appendFileSync(matchesPath, `${match.match_id},${delta.toFixed(2)},${maxHeroAdv.toFixed(2)},${radiantWon ? 1 : 0},${direWon}\n`, "utf8");

      // Append to detailed
      const rBase = rad.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
      const dBase = dir.reduce((s, i) => s + Number(data.heroesWr[i] || 0), 0);
      const rAdv = rTeam.perHeroAdvantages.reduce((a, b) => a + b, 0);
      const dAdv = dTeam.perHeroAdvantages.reduce((a, b) => a + b, 0);
      fs.appendFileSync(
        detailedPath,
        [
          match.match_id,
          dir.map((i) => data.heroes[i]).join("|"),
          r2(dBase), r2(dAdv), r2(dBase + dAdv),
          rad.map((i) => data.heroes[i]).join("|"),
          r2(rBase), r2(rAdv), r2(rBase + rAdv),
          r2(delta),
          (radiantWon ? 1 : 0), direWon
        ].join(",") + "\n",
        "utf8"
      );

      // Append combos
      const rPos = rTeam.perHeroAdvantages.filter((x) => x > 0).length;
      const rNeg = rTeam.perHeroAdvantages.filter((x) => x < 0).length;
      const dPos = dTeam.perHeroAdvantages.filter((x) => x > 0).length;
      const dNeg = dTeam.perHeroAdvantages.filter((x) => x < 0).length;
      fs.appendFileSync(combosPath, `${match.match_id},${rPos},${rNeg},${dPos},${dNeg},${radiantWon ? 1 : 0}\n`, "utf8");

      seen.add(match.match_id);
      written++;
      if (written % 50 === 0) console.log(`[stream] written=${written}`);
      if (written >= TOTAL_LIMIT) break;
    }

    if (PAGE_SLEEP_MS) await sleep(PAGE_SLEEP_MS);
  }

  console.log(`[stream] done. written=${written}`);
}

function r2(n) { return Number(n).toFixed(2); }

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

