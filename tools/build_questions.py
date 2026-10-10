#!/usr/bin/env python3
"""Builds data/questions-generated.json (capitals both ways, flag questions, map-tap
questions) from data/capitals.json + data/territories.json. Deterministic (seeded).
Run:  python3 tools/build_questions.py"""
import json, random, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cap = json.load(open(os.path.join(ROOT, "data/capitals.json")))["countries"]
terr = json.load(open(os.path.join(ROOT, "data/territories.json")))["continents"]
cont_of = {t["iso3"]: c for c in terr for t in c["territories"]}
by = {c["iso3"]: c for c in cap}
rng = random.Random(2026)

def disp(n):  # option text: "the United Kingdom" -> "United Kingdom"
    return n[4:] if n.startswith("the ") else n
def cap1(s): return s[0].upper() + s[1:]

def others(iso, k=3):
    same = [t["iso3"] for t in cont_of[iso]["territories"] if t["iso3"] != iso]
    rng.shuffle(same)
    return same[:k]

def mk(qid, iso, tier, q, opts_iso, correct_iso, field, explain, **extra):
    options = [field(i) for i in opts_iso]
    rng.shuffle(options)
    item = {"id": qid, "continent": cont_of[iso]["name"], "territory": iso, "tier": tier,
            "q": q, "options": options, "answer": options.index(field(correct_iso)), "explain": explain}
    item.update(extra)
    return item

out = []
TF = {"fwd": {1: "easy", 2: "medium", 3: "medium"}, "rev": {1: "easy", 2: "medium", 3: "hard"},
      "flag": {1: "easy", 2: "medium", 3: "hard"}, "pick": {1: "easy", 2: "easy", 3: "medium"},
      "map": {1: "easy", 2: "medium", 3: "hard"}}
for c in cap:
    iso, f = c["iso3"], c["fame"]
    note = (" " + c["note"]) if c.get("note") else ""
    exp = f"{c['capital']} is the capital of {c['name']}.{note}"
    opts = [iso] + others(iso)
    out.append(mk(f"CAP-F-{iso}", iso, TF["fwd"][f], f"What is the capital city of {c['name']}?",
                  opts, iso, lambda i: by[i]["capital"], exp, type="text", category="capitals"))
    opts = [iso] + others(iso)
    out.append(mk(f"CAP-R-{iso}", iso, TF["rev"][f], f"{c['capital']} is the capital of which country?",
                  opts, iso, lambda i: disp(by[i]["name"]), exp, type="text", category="capitals", answerIsTerritory=True))
    opts = [iso] + others(iso)
    out.append(mk(f"FLAG-N-{iso}", iso, TF["flag"][f], "Which country does this flag belong to?",
                  opts, iso, lambda i: disp(by[i]["name"]), f"That's the flag of {c['name']}!",
                  type="flag", image=f"assets/flags/{iso}.svg", category="flags", answerIsTerritory=True))
    opts = [iso] + others(iso)
    item = mk(f"FLAG-P-{iso}", iso, TF["pick"][f], f"Which of these is the flag of {c['name']}?",
              opts, iso, lambda i: i, f"That's the flag of {c['name']}!", type="flag-pick", category="flags")
    item["optionFlags"] = item["options"]                      # iso3 codes -> images
    item["options"] = [disp(by[i]["name"]) for i in item["optionFlags"]]  # text fallback / a11y labels
    out.append(item)
    out.append({"id": f"MAP-{iso}", "continent": cont_of[iso]["name"], "territory": iso, "tier": TF["map"][f],
                "type": "map", "category": "map", "target": iso, "answerIsTerritory": True,
                "q": f"Find {c['name']} on the map and tap it!", "options": [], "answer": None,
                "explain": f"{cap1(c['name'])} is in {cont_of[iso]['name']}. Its capital is {c['capital']}."})
json.dump(out, open(os.path.join(ROOT, "data/questions-generated.json"), "w"), ensure_ascii=False, indent=0)
print("wrote", len(out), "generated questions")
