#!/usr/bin/env python3
"""Pack real ADS-B contacts (bearing, range, altitude, category) into a compact
binary for the browser point field on /projects/adsb-aircraft-tracker.

Source: the tracker's altitude_vs_range export (receiver-relative polar records,
no coordinates). Output: public/projects/adsb/contacts.bin, little-endian
records of [bearing u16 (deg), range u16 (10 m units), altitude u16 (10 ft
units), category u8, pad u8], plus contacts.json with counts and extents.
Military contacts are kept in full; civilian contacts are thinned to a target
total so the file stays small on mobile.
"""
import json, math, os, random, struct, sys

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/adsb-tracker/exports/altitude_vs_range.json")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "projects", "adsb")
TARGET = 60000
CATS = {"civilian": 0, "usaf": 1, "army": 2}

rows = json.load(open(SRC))
random.seed(7)
mil = [r for r in rows if r["category"] != "civilian"]
civ = [r for r in rows if r["category"] == "civilian"]
random.shuffle(civ)
keep = mil + civ[: max(0, TARGET - len(mil))]
random.shuffle(keep)

os.makedirs(OUT_DIR, exist_ok=True)
buf = bytearray()
for r in keep:
    buf += struct.pack("<HHHBB", int(r["bearing"]) % 360, min(65535, int(round(r["range_km"] * 100))),
                       min(65535, int(round(r["altitude_ft"] / 10))), CATS[r["category"]], 0)
open(os.path.join(OUT_DIR, "contacts.bin"), "wb").write(buf)
meta = {
    "records": len(keep), "sourceRecords": len(rows), "recordBytes": 8,
    "fields": ["bearing_deg:u16", "range_10m:u16", "altitude_10ft:u16", "category:u8", "pad:u8"],
    "categories": {v: k for k, v in CATS.items()},
    "maxRangeKm": max(r["range_km"] for r in rows),
    "plotRangeKm": math.ceil(max(r["range_km"] for r in rows)),  # outer ring = the max observed range in this window
    "maxAltitudeFt": max(r["altitude_ft"] for r in rows),
    "counts": {k: sum(1 for r in rows if r["category"] == k) for k in CATS},
    "keptCounts": {k: sum(1 for r in keep if r["category"] == k) for k in CATS},
}
json.dump(meta, open(os.path.join(OUT_DIR, "contacts.json"), "w"), indent=2)
print(json.dumps(meta, indent=2), f"\n{len(buf)/1024:.0f} KB")
