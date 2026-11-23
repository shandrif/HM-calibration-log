#!/usr/bin/env python3
"""Sync stores from Master_Location_Mapping.xlsx into the app database (Cloudflare D1).

Input: the "Location_Mapping" sheet as either
  * the text export returned by the Microsoft 365 connector's read_resource (tab-separated,
    starting with "## Sheet: Location_Mapping"), or
  * a .tsv / .csv file with the same header row, or
  * the .xlsx file itself (needs `pip install openpyxl`).

Usage:
  python3 -I scripts/sync_stores.py <file> [--dry-run] [--local]

  --dry-run  parse and print what would change, write nothing
  --local    write to the local dev database through `wrangler d1 execute --local`

Remote writes use the Cloudflare D1 HTTP API with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

Rules:
  * Only rows with LOCATION_TYPE Branch or Kiosk are imported (warehouses/factories/kitchens are skipped).
  * The store login code is SOURCE_SUBINVENTORY (e.g. RIY031).
  * PINs, staff names, espresso setup and radius are never touched. New stores get no PIN:
    head office generates PINs in /admin ("Generate missing PINs").
  * A master-synced store that disappears from the sheet is deactivated (never deleted).
  * Refuses to write if fewer than 50 stores are parsed (protects against a broken export).
"""

import csv
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP_TYPES = {"Branch", "Kiosk"}
MIN_STORES = 50


def load_rows(path):
    if path.lower().endswith(".xlsx"):
        import openpyxl  # type: ignore

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb["Location_Mapping"]
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(it)]
        return [dict(zip(header, ["" if v is None else str(v).strip() for v in r])) for r in it]

    text = open(path, encoding="utf-8-sig").read()
    if "## Sheet: Location_Mapping" in text:
        lines = text.split("\n")
        start = next(i for i, l in enumerate(lines) if l.startswith("## Sheet: Location_Mapping"))
        header = lines[start + 1].split("\t")
        rows = []
        for line in lines[start + 2 :]:
            if not line.strip() or line.startswith("## ") or line.startswith("Formulas"):
                break
            rows.append(dict(zip(header, [c.strip() for c in line.split("\t")])))
        return rows
    dialect = "excel-tab" if "\t" in text.split("\n", 1)[0] else "excel"
    return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(io.StringIO(text), dialect=dialect)]


def num(v, lo, hi):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if lo <= f <= hi and f != 0 else None


PLACEHOLDERS = {"", "N/A", "NA", "NON EXISTING", "NONE", "-", "#N/A"}


def first_real(r, *cols):
    """First column value that is not empty or a placeholder such as "NON EXISTING"."""
    for c in cols:
        v = (r.get(c) or "").strip()
        if v.upper() not in PLACEHOLDERS:
            return v
    return ""


def to_store(r):
    code = (r.get("SOURCE_SUBINVENTORY") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9-]{2,16}", code):
        return None
    if (r.get("LOCATION_TYPE") or "").strip() not in KEEP_TYPES:
        return None
    name = first_real(r, "LINKTREE_NAME_EN", "BRANCHES_CODES_NAME", "SOURCE_SUBINVENTORY_DESC", "SYRVE_NAME") or code
    return {
        "code": code,
        "name": name[:80],
        "name_ar": (first_real(r, "LINKTREE_NAME_AR") or "")[:80],
        "lat": num(r.get("LATITUDE"), -90, 90),
        "lng": num(r.get("LONGITUDE"), -180, 180),
        "syrve_code": r.get("SYRVE_CODE", ""),
        "city": r.get("CITY", ""),
        "region": r.get("REGION", ""),
        "zone": r.get("ZONE_NAME", ""),
        "sub_zone": r.get("SUB_ZONE_NAME", ""),
        "area_manager": r.get("AREA_MANAGER", ""),
        "rom": r.get("ROM", ""),
        "email": r.get("BRANCH_EMAIL", ""),
        "location_type": r.get("LOCATION_TYPE", ""),
        "drive_thru": r.get("DRIVE_THRU_TYPE", ""),
        "coord_evidence": r.get("COORD_EVIDENCE", ""),
        "opening_date": r.get("OPENING_DATE", ""),
    }


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


TEXT_COLS = ["syrve_code", "city", "region", "zone", "sub_zone", "area_manager", "rom", "email", "location_type", "drive_thru", "coord_evidence", "opening_date"]


def build_sql(stores, now):
    out = []
    for s in stores:
        cols = ["code", "name", "name_ar", "pin_hash", "pin_salt", "lat", "lng", "radius_m", "espresso_mode", "created_at", *TEXT_COLS, "source", "synced_at"]
        vals = [s["code"], s["name"], s["name_ar"], "", "", s["lat"], s["lng"], 500, "pair", now, *[s[c] for c in TEXT_COLS], "master", now]
        updates = ["name = excluded.name", "name_ar = excluded.name_ar", "lat = COALESCE(excluded.lat, stores.lat)", "lng = COALESCE(excluded.lng, stores.lng)"]
        updates += [f"{c} = excluded.{c}" for c in TEXT_COLS] + ["source = 'master'", "synced_at = excluded.synced_at"]
        out.append(f"INSERT INTO stores ({', '.join(cols)}) VALUES ({', '.join(q(v) for v in vals)}) ON CONFLICT (code) DO UPDATE SET {', '.join(updates)};")
    # stores that came from the master file earlier but are no longer in it
    out.append(f"UPDATE stores SET active = 0 WHERE source = 'master' AND synced_at < {now} AND active = 1;")
    return out


def database_id():
    txt = open(os.path.join(ROOT, "wrangler.jsonc"), encoding="utf-8").read()
    return re.search(r'"database_id"\s*:\s*"([0-9a-f-]{36})"', txt).group(1)


def d1_remote(sql, params=None):
    acc = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/d1/database/{database_id()}/query"
    body = {"sql": sql}
    if params:
        body["params"] = params
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if not res.get("success"):
        raise SystemExit("D1 error: " + json.dumps(res.get("errors")))
    return res["result"]


def d1_local(sql):
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", "hm-calibration-db", "--local", "--json", "--command", sql],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise SystemExit(out.stderr[-2000:])
    return json.loads(out.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    local = "--local" in sys.argv
    if not args:
        raise SystemExit(__doc__)
    rows = load_rows(args[0])
    stores = [s for s in (to_store(r) for r in rows) if s]
    codes = [s["code"] for s in stores]
    dupes = sorted({c for c in codes if codes.count(c) > 1})
    if dupes:
        raise SystemExit(f"Duplicate store codes in sheet: {dupes}")
    if len(stores) < MIN_STORES:
        raise SystemExit(f"Only {len(stores)} stores parsed (need at least {MIN_STORES}); nothing written. Check the export.")

    existing_sql = "SELECT code, source, active, pin_hash != '' AS has_pin FROM stores"
    if dry:
        existing = []
    elif local:
        existing = d1_local(existing_sql)[0]["results"]
    else:
        existing = d1_remote(existing_sql)[0]["results"]
    by_code = {e["code"]: e for e in existing}
    new_codes = [c for c in codes if c not in by_code]
    gone = [e["code"] for e in existing if e["source"] == "master" and e["active"] and e["code"] not in set(codes)]
    no_coords = [s["code"] for s in stores if s["lat"] is None or s["lng"] is None]
    weak_coords = [s["code"] for s in stores if s["coord_evidence"] and s["coord_evidence"] != "Confirmed"]

    summary = {
        "rows_in_sheet": len(rows),
        "stores_in_sheet": len(stores),
        "skipped_non_store_rows": len(rows) - len(stores),
        "new_stores": new_codes,
        "updated_stores": len(stores) - len(new_codes),
        "deactivated_missing_from_sheet": gone,
        "stores_without_coordinates": no_coords,
        "stores_with_unconfirmed_coordinates": weak_coords,
        "stores_without_pin": sorted([c for c in codes if c in new_codes or not by_code.get(c, {}).get("has_pin")]),
        "dry_run": dry,
        "target": "local" if local else "remote",
    }

    if not dry:
        now = int(time.time() * 1000)
        stmts = build_sql(stores, now)
        for i in range(0, len(stmts), 25):
            chunk = "\n".join(stmts[i : i + 25])
            if local:
                d1_local(chunk)
            else:
                d1_remote(chunk)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
