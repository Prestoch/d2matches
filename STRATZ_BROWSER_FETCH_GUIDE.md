# Stratz Browser Fetch Guide

Since automated scripts are blocked by Cloudflare, we'll fetch data using your browser.

## Step-by-Step Instructions

### Step 1: Prepare Match IDs

First, create a simple HTTP server to serve the CSV file:

```bash
cd /workspace/out
python3 -m http.server 8000
```

### Step 2: Open Browser Console

1. Open your browser and go to: **http://localhost:8000/matches_detailed.csv**
2. Copy the entire CSV content
3. Open a new tab and go to: **https://stratz.com**
4. Press **F12** to open Developer Tools
5. Go to the **Console** tab

### Step 3: Load Match IDs

Paste this in the console to load match IDs:

```javascript
// Paste your CSV content here as a string
const csvData = `your_csv_content_here`;

window.matchIds = csvData.split('\n').slice(1).map(line => {
  const parts = line.split(',');
  return parts[0];
}).filter(id => id && id.trim());

console.log('✅ Loaded', window.matchIds.length, 'match IDs');
```

### Step 4: Run the Fetch Script

1. Open `/workspace/scripts/browser_fetch_stratz.js`
2. Copy the **entire contents**
3. Paste into the browser console
4. Press **Enter**

The script will:
- Fetch matches at ~240/min (under Stratz limits)
- Show progress in console
- Auto-copy results to clipboard when done

### Step 5: Save the Results

1. Wait for "✅ COMPLETE!" message
2. The JSON data will be in your clipboard
3. Create a file: `stratz_browser_cache.json`
4. Paste the clipboard content into it
5. Save the file

### Step 6: Merge into Main Cache

```bash
node /workspace/scripts/merge_stratz_browser_cache.js stratz_browser_cache.json
```

## Alternative: Multiple Sessions

Since each API key has 10,000 calls/day, you can:

1. **Run with Key 1** (matches 0-10,000)
   - Change `START_INDEX = 0`, `END_INDEX = 10000`
   
2. **Run with Key 2** (matches 10,000-20,000)
   - Change the API_KEY in the script
   - Change `START_INDEX = 10000`, `END_INDEX = 20000`
   
3. **Run with Key 3** (matches 20,000-30,000)
   - Change the API_KEY in the script
   - Change `START_INDEX = 20000`, `END_INDEX = 30000`

## Expected Timeline

- **10,000 matches** at 240/min = ~42 minutes per session
- **3 keys** × 10,000 = 30,000 matches in ~2 hours (if run in parallel tabs)

## Troubleshooting

**If you get rate limited:**
- Increase `DELAY_MS` to 300 or 400
- Reduces to 200/min or 150/min

**If browser tab crashes:**
- Data is auto-saved to `window.stratzCache`
- You can resume by accessing that variable

**To resume from where you left off:**
- Note the last match ID from console
- Update `START_INDEX` to continue from there
