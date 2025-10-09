#!/usr/bin/env python3
"""
Remove duplicate matches from CSV
Keeps first occurrence of each match ID
"""

import sys
import os

def remove_duplicates(input_file, output_file=None):
    if not output_file:
        base, ext = os.path.splitext(input_file)
        output_file = f"{base}_unique{ext}"
    
    print(f'📥 Reading CSV: {input_file}')
    
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    header = lines[0]
    data_lines = [line for line in lines[1:] if line.strip()]
    
    print(f'📊 Original rows: {len(data_lines)}')
    
    # Track seen match IDs
    seen = set()
    unique_lines = []
    
    for line in data_lines:
        match_id = line.split(',')[0]
        
        if match_id not in seen:
            seen.add(match_id)
            unique_lines.append(line)
    
    print(f'✅ Unique rows: {len(unique_lines)}')
    print(f'❌ Duplicates removed: {len(data_lines) - len(unique_lines)}')
    
    # Write cleaned CSV
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(header)
        f.writelines(unique_lines)
    
    print(f'💾 Saved to: {output_file}')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 remove_csv_duplicates.py <input.csv> [output.csv]')
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    remove_duplicates(input_file, output_file)
