#!/usr/bin/env python3
"""Validates every question file. Exit 1 on any error.  python3 tools/validate.py"""
import json, glob, os, sys, collections, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
terr = json.load(open("data/territories.json"))["continents"]
cont_names = {c["name"] for c in terr}
isos = {t["iso3"]: c["name"] for c in terr for t in c["territories"]}
files = sorted(glob.glob("data/questions-*.json"))
errs, allq = [], []
for f in files:
    for x in json.load(open(f)):
        x["_file"] = f; allq.append(x)
ids, texts = collections.Counter(), collections.Counter()
for x in allq:
    i = x.get("id"); ids[i] += 1
    texts[(x.get("q", "").strip().lower(), x.get("image"), x.get("type"))] += 1
    t = x.get("type", "text")
    def E(m): errs.append(f"{x['_file']} {i}: {m}")
    for k in ("id", "q", "tier", "continent", "explain"):
        if not x.get(k): E(f"missing {k}")
    if x.get("tier") not in ("easy", "medium", "hard"): E("bad tier")
    if x.get("continent") not in cont_names: E("bad continent")
    tr = x.get("territory")
    if tr is not None and tr not in isos: E(f"unknown territory {tr}")
    if tr and isos.get(tr) != x.get("continent"): E("territory/continent mismatch")
    if t == "map":
        if x.get("target") not in isos: E("map target not playable")
        continue
    o = x.get("options") or []
    if len(o) != 4: E(f"{len(o)} options")
    if len(set(s.strip().lower() for s in o)) != len(o): E("duplicate options")
    if not isinstance(x.get("answer"), int) or not 0 <= x["answer"] < len(o): E("answer index out of range")
    if any(w in " ".join(o).lower() for w in ("all of the above", "none of the above", "both ")): E("positional option (breaks shuffle)")
    if t == "flag" and not os.path.exists(x.get("image", "")): E("flag image missing")
    if t == "flag-pick":
        fl = x.get("optionFlags") or []
        if len(fl) != 4 or any(not os.path.exists(f"assets/flags/{c}.svg") for c in fl): E("flag-pick flags bad")
        elif fl[x["answer"]] != tr: E("flag-pick answer is not the territory's flag")
for i, n in ids.items():
    if n > 1: errs.append(f"duplicate id {i}")
for k, n in texts.items():
    if n > 1 and k[2] != "flag": errs.append(f"duplicate question text: {k[0]}")
# A question whose correct answer IS the contested country (e.g. "Which country's flag is this?")
# would be a giveaway on that country, so the game only uses it on OTHER countries -> not counted.
def norm(s): return re.sub(r"[^a-z]", "", s.lower().replace("the ", ""))
NAMES = {t["iso3"]: {norm(t["name"])} for c in terr for t in c["territories"]}
cap_path = "data/capitals.json"
if os.path.exists(cap_path):
    for c in json.load(open(cap_path))["countries"]: NAMES[c["iso3"]].add(norm(c["name"]))
def giveaway(x):
    if x.get("answerIsTerritory"): return True
    if x.get("type") == "flag-pick": return False
    o = x.get("options") or []
    return bool(x.get("territory") and o and isinstance(x.get("answer"), int) and x["answer"] < len(o)
                and norm(o[x["answer"]]) in NAMES.get(x["territory"], ()))
nga = [x["id"] for x in allq if giveaway(x) and not x.get("answerIsTerritory")]
if nga: print(f"note: {len(nga)} hand-written questions answer with their own country (used for neighbours only):", " ".join(nga[:40]))
cov = collections.Counter((x["territory"], x["tier"]) for x in allq if x.get("territory") and not giveaway(x))
gaps = [(c, t) for c in isos for t in ("easy", "medium", "hard") if cov[(c, t)] == 0]
REQUIRE_COVERAGE = "--require-coverage" in sys.argv
for g in gaps:
    (errs.append if REQUIRE_COVERAGE else print)(f"coverage gap {g}" + ("" if REQUIRE_COVERAGE else " (warning)"))
thin = [(c, t, cov[(c, t)]) for c in isos for t in ("easy", "medium", "hard") if 0 < cov[(c, t)] < 3]
print(f"{len(allq)} questions in {len(files)} files")
print("by tier:", dict(collections.Counter(x["tier"] for x in allq)))
print("by type:", dict(collections.Counter(x.get("type", "text") for x in allq)))
print("by category:", dict(collections.Counter(x.get("category", "general") for x in allq)))
print("by continent:", dict(collections.Counter(x["continent"] for x in allq)))
print(f"country/tier slots with <3 questions: {len(thin)} of {len(isos)*3}")
if errs:
    print(f"\n{len(errs)} ERRORS:"); print("\n".join(errs[:80])); sys.exit(1)
print("OK")
