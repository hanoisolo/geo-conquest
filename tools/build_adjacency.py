#!/usr/bin/env python3
"""Build data/adjacency.json: land neighbours among the 68 playable countries.
Two countries are neighbours when their outlines share at least 2 vertices (Natural Earth
polygons use identical vertices along shared borders). Used by multiplayer strike-backs."""
import json, collections
terr = json.load(open("data/territories.json"))
play = {t["iso3"] for c in terr["continents"] for t in c["territories"]}
geo = json.load(open("data/countries.geojson"))
pts = collections.defaultdict(set)
def rings(g):
    if g["type"] == "Polygon": yield from g["coordinates"]
    elif g["type"] == "MultiPolygon":
        for p in g["coordinates"]: yield from p
for f in geo["features"]:
    iso = f["properties"].get("iso3")
    if iso not in play: continue
    for r in rings(f["geometry"]):
        for x, y in r: pts[(round(x, 4), round(y, 4))].add(iso)
pair = collections.Counter()
for s in pts.values():
    s = sorted(s)
    for i in range(len(s)):
        for j in range(i + 1, len(s)): pair[(s[i], s[j])] += 1
adj = {i: [] for i in sorted(play)}
for (a, b), n in pair.items():
    if n >= 2: adj[a].append(b); adj[b].append(a)
for k in adj: adj[k].sort()
json.dump(adj, open("data/adjacency.json", "w"), indent=0, separators=(",", ":"))
print(sum(len(v) for v in adj.values()) // 2, "borders;", sum(1 for v in adj.values() if not v), "countries with no land neighbour")
