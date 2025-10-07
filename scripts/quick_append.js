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
const OPEN_DOTA_API_KEY = process.env.OPEN_DOTA_API_KEY || process.env.OPENDOTA_API_KEY || "";
const DAYS = Number(process.env.DAYS || 3650);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS || 4000);
const SLEEP_MS = Number(process.env.SLEEP_MS || 200);
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 16);
const DETAIL_SLEEP_MS = Number(process.env.DETAIL_SLEEP_MS || 80);
const RETRIES = Number(process.env.RETRIES || 5);
const MAX_RPM = Number(process.env.MAX_RPM || 1200);
const TARGET_TOTAL = Number(process.env.TARGET_TOTAL || 50000);
const APPEND_BATCH_SIZE = Number(process.env.APPEND_BATCH_SIZE || 300);
const START_FROM_OLDEST = String(process.env.START_FROM_OLDEST || "").trim() === "1";
const START_FROM_ID = Number(process.env.START_FROM_ID || 0); // if >0, start paging from just below this ID

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let __tokens = MAX_RPM;
let __lastRefill = Date.now();
function refillTokens() {
  const now = Date.now();
  const elapsedMs = now - __lastRefill;
  if (elapsedMs <= 0) return;
  const add = (elapsedMs / 60000) * MAX_RPM;
  if (add > 0) {
    __tokens = Math.min(MAX_RPM, __tokens + add);
    __lastRefill = now;
  }
}
async function rateLimitAcquire() {
  if (!Number.isFinite(MAX_RPM) || MAX_RPM <= 0) return;
  while (true) {
    refillTokens();
    if (__tokens >= 1) { __tokens -= 1; return; }
    const waitMs = Math.max(25, Math.ceil(60000 / MAX_RPM));
    await sleep(waitMs);
  }
}

function appendApiKey(url) {
  if (!OPEN_DOTA_API_KEY) return url;
  try {
    const u = new URL(url);
    if (!String(u.origin + u.pathname).startsWith(OPEN_DOTA_BASE)) return url;
    if (!u.searchParams.has("api_key")) u.searchParams.set("api_key", OPEN_DOTA_API_KEY);
    return u.toString();
  } catch (_) {
    return url + (url.includes("?") ? "&" : "?") + `api_key=${encodeURIComponent(OPEN_DOTA_API_KEY)}`;
  }
}

function httpGetJsonRaw(u) {
  return new Promise((resolve, reject) => {
    const url = new URL(u);
    const req = https.request(url, { method: "GET", headers: { "User-Agent": "quick-append/1.0", Accept: "application/json" } }, (res) => {
      let data = ""; res.on("data", (c) => data += c);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else if (res.statusCode === 429) {
          resolve({ __rate_limited: true });
        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
      });
    });
    req.on("error", reject); req.end();
  });
}

async function fetchJsonWithRetry(url, retries = RETRIES, baseDelay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      await rateLimitAcquire();
      const r = await httpGetJsonRaw(appendApiKey(url));
      if (r && r.__rate_limited) { await sleep(baseDelay * Math.pow(2, i)); continue; }
      return r;
    } catch (e) {
      if (i === retries) throw e; await sleep(baseDelay * Math.pow(2, i));
    }
  }
}

async function fetchHeroList() {
  const constants = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/constants/heroes`);
  if (constants && typeof constants === "object" && !Array.isArray(constants)) {
    return Object.values(constants).map((h) => ({ id: Number(h.id), localized_name: h.localized_name, name: h.name }));
  }
  const hs = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/heroes`);
  if (Array.isArray(hs)) return hs.map((h) => ({ id: h.id, localized_name: h.localized_name, name: h.name }));
  throw new Error("failed to fetch hero list");
}

function buildHeroIdToIndexMap(openDotaHeroes, modelData) {
  const nameToIndex = new Map();
  modelData.heroes.forEach((n, i) => nameToIndex.set(String(n).toLowerCase(), i));

  const idToIndex = new Map();
  const list = Array.isArray(openDotaHeroes)
    ? openDotaHeroes
    : (openDotaHeroes && typeof openDotaHeroes === "object")
      ? Object.values(openDotaHeroes)
      : [];
  for (const h of list) {
    const namesToTry = [h.localized_name, String(h.localized_name || "").replace(/-/g, " ")];
    let idx = undefined;
    for (const candidate of namesToTry) {
      const k = String(candidate || "").toLowerCase();
      if (nameToIndex.has(k)) { idx = nameToIndex.get(k); break; }
    }
    if (idx === undefined) {
      const alt = String(h.localized_name || "").toLowerCase()
        .replace(/[’'`]/g, "")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (nameToIndex.has(alt)) idx = nameToIndex.get(alt);
    }
    if (idx !== undefined) idToIndex.set(Number(h.id), idx);
  }
  return idToIndex;
}

function extractTeams(detail, idToIndex) {
  if (Array.isArray(detail.players)) {
    const r = [], d = [];
    for (const p of detail.players) {
      const heroId = Number(p.hero_id || 0); if (!heroId) continue;
      const idx = idToIndex.get(heroId); if (idx === undefined) continue;
      const isRad = (p.isRadiant !== undefined) ? !!p.isRadiant : (Number(p.player_slot) < 128);
      if (isRad) r.push(idx); else d.push(idx);
    }
    if (r.length === 5 && d.length === 5) return { radiant: r, dire: d };
  }
  const pb = detail.picks_bans;
  if (Array.isArray(pb)) {
    const r = [], d = [];
    for (const x of pb) {
      if (!x || x.is_pick !== true) continue;
      const heroId = Number(x.hero_id || 0); if (!heroId) continue;
      const idx = idToIndex.get(heroId); if (idx === undefined) continue;
      if (x.team === 0 && r.length < 5) r.push(idx);
      if (x.team === 1 && d.length < 5) d.push(idx);
      if (r.length === 5 && d.length === 5) break;
    }
    if (r.length === 5 && d.length === 5) return { radiant: r, dire: d };
  }
  return null;
}

function readExisting(csvPath) {
  const set = new Set();
  let count = 0;
  let minId = null;
  if (!fs.existsSync(csvPath)) return { set, count };
  const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
  if (lines.length <= 1) return { set, count };
  const header = lines.shift().split(",");
  const map = new Map(header.map((h, i) => [h, i]));
  for (const l of lines) {
    const c = l.split(",");
    const mid = c[map.get("match_id")];
    if (mid) set.add(String(mid));
    const n = Number(mid);
    if (Number.isFinite(n)) minId = (minId === null || n < minId) ? n : minId;
    count++;
  }
  return { set, count, minId };
}

async function main() {
  const outDir = path.resolve(__dirname, "../out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const matchesPath = path.join(outDir, "matches.csv");
  const exists = fs.existsSync(matchesPath);
  if (!exists) fs.writeFileSync(matchesPath, "match_id,delta,max_hero_adv,radiant_win,dire_win\n", "utf8");

  const existing = readExisting(matchesPath);
  const need = Math.max(0, TARGET_TOTAL - existing.count);
  if (need <= 0) { console.log(`[quick] target met (${existing.count} >= ${TARGET_TOTAL})`); return; }
  console.log(`[quick] existing=${existing.count} need=${need}`);

  const data = loadCounterData(path.resolve(__dirname, "../cs.json"));
  const heroList = await fetchHeroList();
  const idToIndex = buildHeroIdToIndexMap(heroList, data);

  // Gather candidate IDs incrementally
  const cutoff = Math.floor(Date.now() / 1000) - DAYS * 86400;
  let lastId = undefined;
  if (START_FROM_ID > 0) lastId = START_FROM_ID;
  else if (START_FROM_OLDEST && existing.minId) lastId = Number(existing.minId);
  let gathered = [];
  const respectCutoff = !START_FROM_OLDEST;
  for (let req = 0; req < MAX_REQUESTS && gathered.length < need; req++) {
    const url = lastId ? `${OPEN_DOTA_BASE}/proMatches?less_than_match_id=${lastId}` : `${OPEN_DOTA_BASE}/proMatches`;
    let page = await fetchJsonWithRetry(url, RETRIES, 1000);
    if (!Array.isArray(page) || page.length === 0) break;
    lastId = page[page.length - 1].match_id;
    let added = 0;
    for (const m of page) {
      if (respectCutoff && (m.start_time || 0) < cutoff) continue;
      const mid = String(m.match_id);
      if (START_FROM_ID > 0 && Number(m.match_id) >= START_FROM_ID) continue;
      if (START_FROM_OLDEST && existing.minId && Number(m.match_id) >= Number(existing.minId)) continue;
      if (existing.set.has(mid)) continue;
      gathered.push(m.match_id);
      added++;
      if (gathered.length >= need) break;
    }
    console.log(`[quick] page=${req + 1} added=${added} total=${gathered.length}`);
    if (SLEEP_MS) await sleep(SLEEP_MS);
  }

  console.log(`[quick] gathered candidates=${gathered.length}`);

  // Fetch details and append in batches
  for (let i = 0; i < gathered.length; i += APPEND_BATCH_SIZE) {
    const slice = gathered.slice(i, i + APPEND_BATCH_SIZE);
    let idx = 0; const results = [];
    async function worker() {
      while (true) {
        const j = idx++; if (j >= slice.length) break;
        const id = slice[j];
        try {
          const d = await fetchJsonWithRetry(`${OPEN_DOTA_BASE}/matches/${id}`, RETRIES, 1000);
          if (d && d.match_id) results.push(d);
        } catch (_) {}
        if (DETAIL_SLEEP_MS) await sleep(DETAIL_SLEEP_MS);
      }
    }
    const workers = []; const conc = Math.max(1, DETAIL_CONCURRENCY);
    for (let w = 0; w < conc; w++) workers.push(worker());
    await Promise.all(workers);

    const lines = [];
    for (const match of results) {
      const teams = extractTeams(match, idToIndex);
      if (!teams) continue;
      const { radiant, dire } = teams;
      const rTeam = computeTeamScore(radiant, dire, data);
      const dTeam = computeTeamScore(dire, radiant, data);
      const delta = rTeam.score - dTeam.score;
      const rMax = Math.max(...rTeam.perHeroAdvantages);
      const dMax = Math.max(...dTeam.perHeroAdvantages);
      const maxHeroAdv = Math.max(rMax, dMax);
      const radiantWon = match.radiant_win === true;
      const rw = radiantWon ? 1 : 0;
      const dw = radiantWon ? 0 : 1;
      lines.push(`${match.match_id},${delta.toFixed(2)},${maxHeroAdv.toFixed(2)},${rw},${dw}`);
    }
    if (lines.length) {
      fs.appendFileSync(matchesPath, lines.join("\n") + "\n", "utf8");
      console.log(`[quick] appended=${lines.length} (batch ${(i / APPEND_BATCH_SIZE) + 1})`);
    } else {
      console.log(`[quick] appended=0 (batch ${(i / APPEND_BATCH_SIZE) + 1})`);
    }
    if (TARGET_TOTAL > 0) {
      const newCount = readExisting(matchesPath).count;
      if (newCount >= TARGET_TOTAL) { console.log(`[quick] reached target ${TARGET_TOTAL}`); break; }
    }
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

