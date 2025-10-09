# Stratz 3-Thread Browser Fetch Guide

Run 3 parallel browser sessions to fetch 30,000 matches in ~40 minutes!

## Quick Start

### 1. Prepare Once (Do this first)

Start a local web server:
```bash
cd /workspace/out
python3 -m http.server 8888
```

### 2. Open 3 Browser Tabs

Open 3 separate tabs/windows at: **https://stratz.com**

In **EACH TAB**, press **F12** → go to **Console** tab

### 3. Load Match IDs (Once per tab)

Paste this in **EACH TAB's console**:

```javascript
fetch("http://localhost:8888/matches_detailed.csv")
  .then(r=>r.text())
  .then(csv=>{
    window.matchIds=csv.split("\n").slice(1).map(l=>l.split(",")[0]);
    console.log("✅",window.matchIds.length,"IDs loaded");
  });
```

### 4. Run Each Thread

**TAB 1:** Copy `/workspace/scripts/browser_fetch_stratz_thread1.js` → Paste → Enter
- Fetches matches **0-10,000**
- Uses API Key 1

**TAB 2:** Copy `/workspace/scripts/browser_fetch_stratz_thread2.js` → Paste → Enter
- Fetches matches **10,000-20,000**
- Uses API Key 2

**TAB 3:** Copy `/workspace/scripts/browser_fetch_stratz_thread3.js` → Paste → Enter
- Fetches matches **20,000-30,000**
- Uses API Key 3

### 5. Monitor Progress

Each tab will show:
```
[T1] 5000/10000 (50.0%) | ✓4850 ✗150
[T2] 3200/10000 (32.0%) | ✓3100 ✗100
[T3] 7800/10000 (78.0%) | ✓7650 ✗150
```

### 6. Save Results

When a tab shows `✅ DONE!`:
1. Data is **auto-copied to clipboard**
2. Create file: `stratz_thread1_cache.json` (or thread2/thread3)
3. Paste clipboard content
4. Save

Repeat for all 3 tabs.

### 7. Merge All 3 Files

```bash
cd /workspace
node scripts/merge_stratz_browser_cache.js stratz_thread1_cache.json
node scripts/merge_stratz_browser_cache.js stratz_thread2_cache.json
node scripts/merge_stratz_browser_cache.js stratz_thread3_cache.json
```

## Timeline

- **10,000 matches/thread** at 240/min ≈ **42 minutes each**
- Running **3 threads in parallel** = **~42 minutes total** for 30,000 matches!

## Troubleshooting

**Rate limited?**
- Increase `DELAY_MS` to 300 or 400 in the script

**Tab crashed?**
- Data saved to `window.stratzCacheT1` (or T2/T3)
- Copy to clipboard: `copy(JSON.stringify(window.stratzCacheT1, null, 2))`

**Want to resume?**
- Note last processed match from console
- Edit `START_INDEX` in the script

## Pro Tips

✅ Run all 3 tabs simultaneously for max speed  
✅ Don't close tabs until you've saved the JSON  
✅ Can save `window.stratzCacheT1/T2/T3` anytime as backup
