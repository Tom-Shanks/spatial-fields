"""Build public/projects/rfpi/orbit-globe.json from the frozen RFPI archive review.

Public projection only: satellite label, capture type, catalog minute, a decimated
saved-TLE orbit (WGS84/ITRS ECEF km) and the archived capture position. Pass IDs,
peak elevations, azimuths, hashes and file paths are dropped because together they
could localise the receiver. Usage (from the repo root):
    python scripts/prepare-orbit-globe.py [path/to/rfpi-story-review]
APRS decode details (frame count, sender versus digipeated) come from the per-pass
manifests in the workbench archive mirror; third-party callsigns are never published.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "rfpi-story-review"
OUT = ROOT / "public/projects/rfpi/orbit-globe.json"
ARCHIVE = ROOT.parent / "rfpi-workbench/data/archive/generations"
IMAGES = ROOT / "public/projects/rfpi/passes"
IMAGE_WIDTH = 1280
# SatDump MSA composite, geometry-corrected, no map overlay (the *_map and projected
# products can carry overlays, so they are never published).
IMAGE_PRODUCT = "msu_mr_rgb_MSA_corrected.png"
ORBIT_POINTS = 72  # decimated samples per orbit; enough for a smooth dashed ellipse at site scale


def ecef(point):
    return [round(point["ecef_x_km"], 1), round(point["ecef_y_km"], 1), round(point["ecef_z_km"], 1)]


def manifest(pass_id):
    """Newest archived manifest for a pass, or None. Read-only."""
    for generation in sorted(ARCHIVE.glob("*"), reverse=True):
        path = generation / "captures" / pass_id / "manifest.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def pass_images(source):
    """pass_id -> verified source path for the published composite, from the private index."""
    import hashlib
    from pathlib import PureWindowsPath
    index = json.loads((source / "private-artifacts.json").read_text(encoding="utf-8"))["artifacts"]
    found = {}
    for value in index.values():
        if value.get("display_name") != IMAGE_PRODUCT:
            continue
        parts = PureWindowsPath(value["path"]).parts
        pass_id = parts[parts.index("captures") + 1] if "captures" in parts else None
        if not pass_id:
            continue
        raw = Path(value["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != value["sha256"]:
            raise SystemExit(f"hash mismatch for {pass_id}; refusing to publish")
        found[pass_id] = Path(value["path"])
    return found


def publish_image(source_path, key):
    from PIL import Image
    IMAGES.mkdir(parents=True, exist_ok=True)
    out = IMAGES / f"{key}.webp"
    with Image.open(source_path) as im:
        im = im.convert("RGB")
        im = im.resize((IMAGE_WIDTH, round(im.height * IMAGE_WIDTH / im.width)), Image.LANCZOS)
        im.save(out, quality=78, method=6)
        return f"/projects/rfpi/passes/{key}.webp", list(im.size)


def mhz(hz):
    return f"{hz / 1e6:.3f} MHz"


def received(record):
    kind = record["capture_type"]
    freq = record.get("frequency_hz")
    audio = sum(1 for a in record.get("artifacts", []) if a.get("kind") == "audio")
    duration = (record.get("actual") or {}).get("duration_s")
    length = f", {int(duration) // 60} min {int(duration) % 60} s" if isinstance(duration, (int, float)) else ""
    if kind == "weather_satellite":
        n = record.get("n_images") or 0
        if n:
            return f"LRPT recorded at 137.9 MHz; SatDump produced {n} MSU-MR image products"
        if (record.get("cadu_bytes") or 0) > 0:
            return "LRPT recorded at 137.9 MHz; frames were written but no image products decoded"
        return "LRPT recording at 137.9 MHz; no frames decoded"
    if kind == "fm":
        # The station's FM profile for AO-73 is marked unverified: 145.960 MHz sits inside the
        # SSB/CW transponder passband and the satellite has no FM downlink (AMSAT-UK spec).
        where = f" at {mhz(freq)}" if freq else ""
        if not audio:
            return f"FM capture logged{where}; no audio retained"
        note = ", inside the SSB/CW transponder passband" if record["satellite"].startswith("FUNCUBE") else ""
        return f"Audio recorded with FM demodulation{where}{note}{length}. No decoder was run and the signal was not assessed"
    where = f" on {mhz(freq)}" if freq else ""
    if not audio:
        return f"APRS capture logged{where}; no audio retained"
    m = manifest(record["pass_id"])
    outcome = (m or {}).get("outcome") or record.get("outcome") or {}
    if not outcome.get("protocol_decoded"):
        return f"APRS audio recorded{where}{length}; no frames decoded"
    packets = ((m or {}).get("evidence") or {}).get("packets") or []
    count = ((m or {}).get("evidence") or {}).get("valid_frame_count") or len(packets) or None
    frames = f"{count} CRC-valid APRS frame{'s' if count != 1 else ''}" if count else "CRC-valid APRS frames"
    if not outcome.get("attribution_supported"):
        return f"APRS audio recorded{where}{length}; {frames} decoded, attribution to the ISS unresolved"
    if packets and all(p.get("source") == "RS0ISS" for p in packets):
        return f"APRS audio recorded{where}{length}; {frames} decoded, sent by the ISS (RS0ISS)"
    if packets and all(any(str(h).startswith("RS0ISS*") for h in p.get("path", [])) for p in packets):
        return f"APRS audio recorded{where}{length}; {frames} decoded, relayed through the ISS digipeater"
    return f"APRS audio recorded{where}{length}; {frames} decoded, attributed to the ISS"


def main():
    story = json.loads((SOURCE / "data/story-data.json").read_text(encoding="utf-8"))
    orbits = json.loads((SOURCE / "data/orbit-context.json").read_text(encoding="utf-8"))
    paths = json.loads((SOURCE / "data/archive-pass-paths.json").read_text(encoding="utf-8"))
    if orbits["source_snapshot_id"] != story["dataset"]["snapshot_id"] or paths["source_snapshot_id"] != story["dataset"]["snapshot_id"]:
        raise SystemExit("orbit context, pathways and catalog are from different snapshots")
    records = {r["pass_id"]: r for r in story["receptions"]}
    images = pass_images(SOURCE)
    passes = []
    for model in sorted(orbits["models"], key=lambda m: m["nominal_utc"]):
        record = records[model["pass_id"]]
        points = model["points"]
        step = max(1, len(points) // ORBIT_POINTS)
        orbit = [ecef(p) for p in points[::step]]
        intercept = model["intercept_point"]
        image = None
        if model["pass_id"] in images:
            # Public key from UTC and spacecraft only; the pass ID carries peak elevation.
            key = record["nominal_utc"][:16].replace("-", "").replace("T", "-").replace(":", "") + ("-m23" if "M23" in model["pass_id"] else "-m24")
            src, size = publish_image(images[model["pass_id"]], key)
            image = {"src": src, "width": size[0], "height": size[1]}
        passes.append({
            "satellite": record["satellite"].replace("Meteor-", "METEOR-"),  # catalog mixes both spellings
            "type": record["capture_type"],
            "utc": record["nominal_utc"][:16] + "Z",
            "received": received(record),
            # Dot time: logged capture-process start, or first decoded scan block (42 weather passes).
            "basis": "scan" if "scan" in model["intercept_time_basis"] else "start",
            "altitudeKm": round(intercept["altitude_km"], 1),
            "intercept": ecef(intercept),
            "orbit": orbit,
            **({"image": image} if image else {}),
        })
    coverage = paths["coverage"]
    out = {
        "source": "RFPI frozen archive review, snapshot " + story["dataset"]["snapshot_id"],
        "frame": "SGP4 (Skyfield) from each pass's saved TLE, TEME converted to ITRS; geodetic on WGS84. ECEF km.",
        "qualification": "Positions are TLE predictions at the logged capture start or first decoded scan; not measured RF tracks.",
        "totals": {"records": coverage["all_archived_records"], "modeled": coverage["modeled_records"],
                   "weather": coverage["by_mode"]["lrpt"], "fm": coverage["by_mode"]["fm"], "aprs": coverage["by_mode"]["aprs"]},
        "range": [passes[0]["utc"], passes[-1]["utc"]],
        "passes": passes,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(passes)} passes, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
