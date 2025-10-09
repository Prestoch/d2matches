#!/usr/bin/env python3
"""
Create clean CSV containing ONLY matches that have successful Stratz position data
Removes both duplicates AND matches with errors
"""

import sys
import json
import os

def create_clean_csv(csv_file, stratz_json, output_file=None):
    if not output_file:
        base, ext = os.path.splitext(csv_file)
        output_file = f"{base}_clean{ext}"
    
    print(f'📥 Reading Stratz cache: {stratz_json}')
    with open(stratz_json, 'r', encoding='utf-8') as f:
        stratz_cache = json.load(f)
    
    # Get successful match IDs (no errors)
    successful_ids = {
        match_id for match_id, data in stratz_cache.items()
        if not data.get('error')
    }
    
    print(f'✅ Successful Stratz matches: {len(successful_ids)}')
    
    print(f'📥 Reading CSV: {csv_file}')
    with open(csv_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    header = lines[0]
    data_lines = [line for line in lines[1:] if line.strip()]
    
    print(f'📊 Original CSV rows: {len(data_lines)}')
    
    # Keep only matches that are in successful_ids
    clean_lines = []
    seen = set()  # Also remove duplicates
    
    for line in data_lines:
        match_id = line.split(',')[0].strip()
        
        # Keep if: (1) in successful Stratz data, AND (2) not seen before (no duplicates)
        if match_id in successful_ids and match_id not in seen:
            seen.add(match_id)
            clean_lines.append(line)
    
    print(f'✅ Clean rows (successful + unique): {len(clean_lines)}')
    print(f'❌ Removed (errors + duplicates): {len(data_lines) - len(clean_lines)}')
    
    # Write cleaned CSV
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(header)
        f.writelines(clean_lines)
    
    print(f'💾 Saved to: {output_file}')
    print(f'\n📊 Final dataset:')
    print(f'   {len(clean_lines)} matches with complete position data')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python3 create_clean_csv.py <matches.csv> <stratz_clean.json> [output.csv]')
        print('')
        print('Example:')
        print('  python3 create_clean_csv.py matches_detailed.csv stratz_clean_96507.json')
        sys.exit(1)
    
    csv_file = sys.argv[1]
    stratz_json = sys.argv[2]
    output_file = sys.argv[3] if len(sys.argv) > 3 else None
    
    create_clean_csv(csv_file, stratz_json, output_file)
