# Continental Progression System

**Version:** 1.1  
**Status:** Design  
**Supersedes:** Level ranges in Verdania (now continent 0, levels 1–10)  
**Depends on:** World Generation Architecture, Biome System

---

## Core Concept

The world is a sequence of continents indexed 0, 1, 2, …  
Each continent spans **10 player levels**. Continent 0 covers levels 1–10, continent 1 covers 11–20, and so on.

At world creation, the player chooses a **starting continent** — Verdania, Grausland, or Petermark — which determines the template applied to continent 0. All three share the same mechanical structure (10 levels, radial objectives, coastal start) but differ in climate, terrain character, and mood. From continent 1 onward, all players converge on the same procedurally generated sequence.

Only one continent is loaded at a time. Sailing to a new continent unloads the current one and generates the next from its seed. Sailing back regenerates the previous continent identically. The terrain system, biome generation, and chunk streaming are **unchanged**—the continental system is an overlay that modulates coastlines, applies climate templates, scales mobs, and places progression objectives.

---

## Seed Hierarchy

```
WorldSeed (user-provided or random)
StartingTemplate (player choice: "verdania" | "grausland" | "petermark")
    │
    ├── ContinentSeed(0) = hash(WorldSeed, 0, StartingTemplate)
    ├── ContinentSeed(1) = hash(WorldSeed, 1)   ← shared convergence, no template in hash
    ├── ContinentSeed(N) = hash(WorldSeed, N)
    │
    └── Each ContinentSeed derives sub-seeds:
        ├── ShapeSeed    = hash(ContinentSeed, "shape")
        ├── CoastSeed    = hash(ContinentSeed, "coast")   ← fbm detail noise
        ├── SpawnSeed    = hash(ContinentSeed, "spawn")
        ├── ObjectiveSeed = hash(ContinentSeed, "objectives")
        ├── SettlementSeed = hash(ContinentSeed, "settlements")
        └── NamingSeed   = hash(ContinentSeed, "names")
```

For continent 0, the StartingTemplate is included in the seed so that two players with the same WorldSeed but different starting choices get different continent 0 layouts. For continent 1+, the template is not part of the seed — all players with the same WorldSeed see the same continents from index 1 onward.

---

## Continental Shape

### Coastline Function: Two-Stage Approach

Using an SDF directly as a coastline shape produces non-organic results: uniform cliffs, blobby inflation artifacts, and no fine detail. Instead, we separate the **spatial query** from the **shape generation**.

**Stage 1: Coarse SDF for proximity detection.**
A low-resolution distance field (1 sample per 8–16 world blocks) stores the approximate distance to the nominal coastline. This is an O(1) lookup that answers: *am I within ~100 blocks of where the coast should be?* If not, the terrain worker skips all coastline logic. This SDF is computed once during continental metadata generation and stored as a small texture.

**Stage 2: High-resolution fbm noise for actual shape.**
When the worker knows it's near the coast, it evaluates a multi-octave noise function at full block resolution:

```
nominalRadius(θ) = baseRadius + amplitude * lowFreqNoise(θ, ShapeSeed)
detailedCoast(x, z) = nominalRadius(θ_xz) + fbm(x, z, CoastSeed, octaves=4-5)
```

The low-frequency noise (2–3 octaves, 6–10 lobes) defines the broad silhouette: major bays, peninsulas, the overall island shape. The fbm adds fine detail: inlets, rocky headlands, small beaches, tidal irregularity. Together they produce organic, natural coastlines with variation at every scale.

The terrain then transitions smoothly using the signed distance from this detailed boundary:

```
coastSignedDist = detailedCoast(x, z) - distFromCenter(x, z)

if coastSignedDist > 50:   terrain unchanged (deep inland)
if 20..50:                  gradual height tapering toward sea level
if 0..20:                   beach zone (sand, dunes, gentle slope)
if -30..0:                  shallow water (wading, visible floor)
if < -30:                   deep ocean (impassable)
```

No cliffs appear unless the inland biome is already mountainous. The coast tapers naturally.

**Parameters:**

- `baseRadius`: Determined by continent index and seed. Grows with N.
- `amplitude`: ~20–30% of baseRadius for the low-frequency silhouette.
- `fbm amplitude`: ~5–15 blocks for fine coastal detail.
- `fbm frequency`: High enough to produce small-scale features (individual block variation at the shore).

### Size Scaling

| Continent Index | Level Range | Approximate Area | baseRadius (blocks) |
|-----------------|-------------|-------------------|---------------------|
| 0               | 1–10        | 10–15 km²         | ~1800–2200          |
| 1               | 11–20       | 15–20 km²         | ~2200–2500          |
| 2               | 21–30       | 20–30 km²         | ~2500–3100          |
| 3+              | 31–40+      | 25–50 km²         | ~2800–4000          |

Exact size is deterministic from `hash(ContinentSeed, "size")` within the range for that index. Small continents produce compressed, intense progression. Large ones are exploration-heavy.

### Terrain Modulation Near Coast

The existing terrain and biome systems generate as normal everywhere. Near the coastline boundary (detected via the coarse SDF), the detailed fbm coastline function computes the actual land/water boundary and applies a smooth transition. The transition distances are defined in the coastline function above.

The existing low-frequency ocean noise **remains active** within the continent interior, creating inland lakes and waterways as before. Only the deep ocean *between* continents is impassable.

### Impassable Deep Ocean

The deep ocean surrounding each continent acts as the world boundary. Implementation options (choose one):

- **Fog wall**: Visibility drops to zero. Ship turns back automatically.
- **Sea monsters**: Aggressive mobs in deep water. Unwinnable.
- **Currents**: Ship is pushed back toward shore.
- **Edge of the world**: Waterfall into void (dramatic, simple).

The fiction matters less than the mechanic: you cannot leave a continent except via the designated sailing point after completing objectives.

---

## Starting Point

### Placement

The player starts **on the coast**, not at the center. The starting point is deterministic:

```
startAngle = hash(ContinentSeed, "startAngle") mapped to [0, 2π]
startPosition = coastPoint(startAngle) - inwardOffset
```

The `inwardOffset` places the player ~20–30 blocks inland from the coastline, on the beach. This gives an immediate sense of arrival: ocean behind you, unexplored continent ahead.

### Narrative

- **Continent 0**: You wash ashore. Tutorial area. Gentle introduction.
- **Continent N>0**: You sail here from the previous continent. You arrive at a dock or beach camp.

The starting point always has a basic landmark (campfire, shipwreck, dock) to orient the player.

---

## Progression Banding

### Distance-Based Level Scaling

Mob level and difficulty scale with **distance from the starting point** (not from the continent center). This creates asymmetric banding: areas near the start are safe, the far side of the continent is dangerous, and the center is mid-range.

```
progressionLevel(position) = baseLevelForContinent + 
    lerp(0, 9, clamp(distFromStart / maxIslandDiameter, 0, 1))
```

For continent 0 (levels 1–10):
- At the starting point: level 1 mobs, passive animals, basic resources.
- At maximum distance from start: level 10 mobs, elite enemies, rare materials.
- The mapping is smooth—no hard band boundaries.

### What Scales With Level

| Attribute | How It Scales |
|-----------|---------------|
| Mob health | Base × (1 + 0.15 × localLevel) |
| Mob damage | Base × (1 + 0.12 × localLevel) |
| Mob density | Increases with distance. More hostile, fewer passive. |
| Mob variety | New types unlock at level thresholds across continents. |
| Resource rarity | Better materials further from start. |
| Landmark complexity | Simple camps near start, elaborate structures far away. |

The scaling formulas apply globally across continents: a level 15 mob on continent 1 is comparable to what a level 15 mob would be anywhere. The continent just determines which 10-level band you're in.

---

## Radial Objectives

### Purpose

To leave a continent, the player must complete **N radial objectives** distributed around the island. This forces exploration of the full continent rather than a beeline to the sailing point.

### Placement

Objectives are placed at specific angles, dividing the island into **wedge-shaped sectors**:

```
For K objectives on continent N:
    objectiveAngles[i] = hash(ObjectiveSeed, i) mapped to evenly-spaced-ish angles
    objectiveDistance[i] = varies (some near coast, some mid-island, some central)
```

- **Continent 0**: 3–4 objectives (introductory, short).
- **Continent 1**: 4–5 objectives.
- **Continent 2+**: 5–6 objectives.

Objective count grows slowly. Each continent should take roughly the same real time (1–3 hours of play), with higher continents compensating larger area with harder but fewer-per-area objectives.

### Objective Types

| Type | Description |
|------|-------------|
| **Boss** | Defeat a named enemy at a specific location. |
| **Collect** | Gather N items from a region (herbs, minerals, artifacts). |
| **Activate** | Find and interact with a landmark (shrine, obelisk, beacon). |
| **Clear** | Eliminate all enemies in a camp or dungeon. |
| **Escort/Deliver** | Transport an item or NPC to a destination. |

The specific type for each objective slot is determined by the seed. Not all types appear on every continent.

### Objective Placement Rules

- No two objectives in adjacent wedge sectors (force the player to traverse the island).
- At least one objective in the **center region** of the island (not all periphery).
- At least one objective at **high progression level** (far from start).
- The center objective can be a narrative anchor: a ruin, a village elder, a sealed vault.

### Wayfinding

The player needs to know which sectors they've visited and which objectives remain. Options:

- **Compass UI**: Directional markers pointing toward uncompleted objectives.
- **Map fog**: A simple radial map that fills in as sectors are explored.
- **Beacon system**: Completed objectives emit a visible light pillar; uncompleted ones are dark.
- **NPC hints**: Villagers describe directions to unexplored areas.

A combination works well: compass markers for guidance, beacon pillars for visual confirmation.

---

## The Center

Not everything radiates outward. The island center serves a distinct role:

- **Narrative hub**: A central landmark (ancient tree, ruined tower, village square) that provides story context for the continent.
- **Mid-difficulty content**: Level ~5 relative to the continent (mid-band), reachable early but interesting to revisit.
- **Convergence point**: Roads and paths from multiple sectors pass through or near the center.
- **Optional objective location**: One radial objective can be placed here, requiring inward exploration.

The center breaks the monotony of outward expansion. The rhythm becomes: start at coast → push inward to center → fan outward to sectors → converge on sailing point.

---

## Sailing and Transition

### Sailing Point

Each continent has a **single sailing point** on the coast, placed at the angle opposite the starting point:

```
sailAngle = startAngle + π + smallOffset
sailPosition = coastPoint(sailAngle) + small inward offset
```

This maximizes the distance between arrival and departure, requiring traversal of the full island diameter.

The sailing point contains:

- A dock or pier (landmark).
- An NPC or mechanism that checks objective completion.
- A visual indicator of progress (e.g., N stones that light up as objectives complete).

### Transition Sequence

1. Player arrives at sailing point.
2. System checks: all N objectives complete?
   - **No**: NPC tells player which objectives remain. Compass updates.
   - **Yes**: Sailing option unlocked.
3. Player initiates sailing.
4. **Sailing animation** plays (auto-sail, 10–20 seconds). During this time:
   - Current continent is unloaded.
   - New continent seed is computed: `hash(WorldSeed, N+1)`.
   - Continental metadata is generated (coastline, objectives, starting point).
   - Terrain worker begins generating initial chunks around the new starting point.
5. Player arrives at new continent's starting point.

### Returning to Previous Continents

The player can sail back to any previously visited continent (not just N-1). The return trip uses the same sailing animation. The previous continent regenerates identically from its seed. Player progress (completed objectives, visited sectors) is stored in the save file, not in the terrain.

---

## Player State and Persistence

### What Persists Across Continents

| Data | Storage |
|------|---------|
| Player level, XP, stats | Save file |
| Inventory and equipment | Save file |
| Starting template choice | Save file (determines continent 0 generation) |
| Per-continent objective completion | Save file (Map: continentIndex → Set of completed objective IDs) |
| Per-continent sector exploration | Save file (Map: continentIndex → visited angle ranges) |
| Current continent index | Save file |
| World seed | Save file |

### What Does Not Persist

| Data | Reason |
|------|--------|
| Terrain modifications (placed/destroyed blocks) | Regenerated from seed. Ephemeral by design. |
| Mob state | Respawned on load. |
| Dropped items | Lost on continent transition. |

This keeps the save file small and the system stateless. Each continent is a fresh challenge reconstructed from its seed.

---

## Starting Continents and Climate

### Player Choice at World Creation

At world creation, the player chooses one of three starting continents. All three are continent index 0 (levels 1–10), but each applies a different **template** that constrains biome palette, climate parameters, elevation profile, and narrative tone.

| Starting Continent | Climate | Terrain Character | Mood |
|--------------------|---------|-------------------|------|
| **Verdania** | Temperate. Warm summers, mild winters. Moderate rainfall. | Rolling hills, forests, sheltered bay, pastoral lowlands. | Cozy, nurturing, classic fantasy. Gentle introduction. |
| **Grausland** | Cold/subarctic. Long winters, short cool summers. High precipitation. | Rocky coastlines, steep hills, conifer forests, exposed ridges. Terrain is rougher and more vertical. | Harsh, Nordic, survival-oriented. Challenge from the start. |
| **Petermark** | Arid/Mediterranean. Hot dry summers, mild wet winters. Low rainfall. | Flat coastal plains, sandstone mesas, sparse scrubland. More open terrain with long sight lines. | Trade-oriented, settlement-heavy, sun-baked. |

The choice affects only the template applied to continent 0. The seed still provides variation within each template.

### How Templates Affect Climate

The existing biome system uses three noise-derived values — temperature, humidity, and elevation — to select biomes via Whittaker lookup. A continent template modulates these values *before* biome selection by applying offsets and clamping ranges:

```
effectiveTemp(x, z)     = clamp(baseTemp(x, z)     + template.tempOffset,     template.tempRange)
effectiveHumidity(x, z) = clamp(baseHumidity(x, z) + template.humidityOffset, template.humidityRange)
```

| Template | tempOffset | tempRange | humidityOffset | humidityRange |
|----------|-----------|-----------|----------------|---------------|
| Verdania | 0.0 | [0.2, 0.8] | 0.0 | [0.3, 0.7] |
| Grausland | -0.25 | [0.0, 0.5] | +0.1 | [0.4, 0.9] |
| Petermark | +0.2 | [0.4, 1.0] | -0.2 | [0.0, 0.5] |

The underlying noise field is the same for all templates — the offsets and clamping shift which part of the Whittaker diagram gets expressed. Verdania sits in the temperate middle. Grausland pulls toward tundra/taiga/snow. Petermark pulls toward desert/savanna/badlands.

The biome system itself is **unchanged**. Templates only adjust the inputs.

### Excluded and Favored Biomes

Each template can also explicitly exclude or favor biomes:

| Template | Excluded Biomes | Favored Biomes |
|----------|----------------|----------------|
| Verdania | glacier, volcanic, red_desert | plains, deciduous_forest, meadow |
| Grausland | jungle, desert, savanna | taiga, tundra, mountains |
| Petermark | glacier, tundra, taiga | desert, savanna, badlands, red_desert |

"Excluded" means the biome is never selected regardless of climate values — the next-closest Whittaker match is used instead. "Favored" means a small bias is applied when two biomes are equally likely, nudging the result toward the template's character.

### Elevation Profile

Templates also constrain the elevation noise:

| Template | Elevation Character | How |
|----------|-------------------|-----|
| Verdania | Gentle hills, one moderate mountain range | Lower `heightScale`, southern mountain spine |
| Grausland | Rugged, steep valleys, exposed ridges | Higher `heightScale`, ridge noise amplified, multiple spines |
| Petermark | Flat plains with isolated mesas | Low base `heightScale`, occasional sharp peak multiplier |

These are multiplicative adjustments to existing terrain generation, not replacements.

---

## Continent Sequence and Convergence

### Continent 0: The Starting Continent

Determined by player choice (Verdania, Grausland, or Petermark). Levels 1–10. Template-constrained.

### Continent 1: Convergence

All players, regardless of starting continent, sail to the **same continent 1**. This continent uses a neutral template — no strong climate bias — producing a mixed biome distribution that contrasts with whatever the player experienced on continent 0. The seed (derived from WorldSeed and index 1) is identical for all players with the same WorldSeed.

This convergence serves several purposes:

- Players who started on different continents arrive at the same place, enabling multiplayer meetups.
- The biome contrast (e.g., a Grausland player arriving at a temperate/tropical continent 1) feels like genuine travel to a new land.
- The game's long-term progression becomes shared regardless of starting choice.

### Continents 2+: Procedural With Drift

From continent 2 onward, templates are assigned procedurally from the seed. The template selection can drift away from the starting continent's climate, introducing biomes the player hasn't encountered yet:

```
templateIndex = hash(ContinentSeed, "template") % templatePool.length
```

The template pool for continent N might include all three starting templates plus additional ones (volcanic, tropical, archipelago) that unlock at higher indices. This keeps each new continent feeling distinct without requiring hand-authored content for every index.

### Climate Drift Across Continents

To prevent repetition, continents can apply a slow drift to climate parameters:

```
driftTemp     = sin(N * 0.7 + hash(WorldSeed, "tempPhase")) * 0.15
driftHumidity = cos(N * 0.5 + hash(WorldSeed, "humPhase")) * 0.15
```

This means continent 3 might be warmer and drier than continent 2, while continent 4 swings back toward cold and wet. The drift is bounded and deterministic — it guarantees variety over a long sequence without ever producing extreme or unplayable climates.

### Template Summary

| Continent | Template Source | Climate |
|-----------|---------------|---------|
| 0 | Player choice (Verdania / Grausland / Petermark) | Template-constrained |
| 1 | Neutral (shared convergence) | Mixed, no strong bias |
| 2+ | Procedural from seed | Drifting, drawn from expanding template pool |

---

## Continental Identity (Non-Climate)

Beyond climate, each continent has procedural variety in:

- Coastline shape (elongated, compact, deep bays — from the fbm coastline function).
- Objective placements and types.
- Starting/sailing orientations.
- Settlement names (from naming palette, seeded per continent).

For future development, templates can also override non-climate properties:

| Template Property | Example |
|-------------------|---------|
| Coastline archetype | "Fjorded" vs "smooth lagoon" |
| Objective count override | "Boss rush: 3 bosses, no collect quests" |
| Visual atmosphere | "Volcanic haze" or "eternal autumn" |
| Road density | "Well-connected" vs "pathless wilderness" |

---

## Settlements, Roads, and Infrastructure

### Settlements

Each continent has deterministically placed settlements:

- **Starting settlement**: At the starting point. Always present. Provides basic services (rest, trade, tutorials on continent 0).
- **Sector settlements**: 1–2 per wedge sector, placed near objectives or at natural waypoints (river crossings, mountain passes). Services scale with local progression level.
- **Center settlement**: Near the center landmark. Acts as a crossroads hub.

Settlement placement uses the existing settlement algorithm (density noise + flatness check), constrained to appropriate progression bands.

### Roads

Roads connect settlements and objectives using existing A* pathfinding:

- **Primary road**: A main route from starting settlement → center → sailing point.
- **Secondary roads**: Branch from the primary road to sector objectives and settlements.
- **Trails**: Informal paths that hint at objective locations without direct routes.

Road quality degrades with distance from start: cobblestone near settlements, dirt in the midlands, faint trails near the periphery.

### Signposts

At road forks:
- Direction to nearest settlement (with distance).
- Warning level ("Danger ahead" for higher-level areas).
- Sector name.

---

## Interaction with Existing Systems

### Biome System

**No changes to the biome selection logic.** The existing Whittaker-based biome selection (temperature × humidity × elevation) operates as before. Continental templates affect biome distribution by applying offsets and clamping ranges to the temperature and humidity *inputs* before they reach the biome selector (see Starting Continents and Climate section). Excluded biomes are filtered at selection time. The coastline modulation overrides surface blocks to sand/shallow water only in the beach/ocean transition zone, applied *after* biome selection.

### Terrain Worker

The terrain worker receives continental metadata (coarse coastline SDF, starting point, continent index, template climate offsets) as part of chunk requests. When the coarse SDF indicates proximity to the coast, the worker evaluates the detailed fbm coastline function and applies the smooth beach/ocean transition. When the template includes climate offsets, the worker applies them to temperature and humidity values before biome selection. These are the only changes to the worker.

### Mob Spawner

The mob spawner reads the local progression level (computed from distance to starting point and continent index) to scale mob stats. The existing biome-based spawn tables remain; the progression level multiplies health/damage/XP. New mob types can be gated by continent index (e.g., "skeleton archers only appear on continent 2+").

### Landmarks

Existing landmark placement (temples, camps) continues. Landmarks are distributed by the seed across the continent, with density and complexity scaling with progression level. Radial objectives may coincide with landmarks.

### Day/Night Cycle

Unchanged. Night increases mob density and aggression as before, independent of progression banding.

---

## Implementation Phases

### Phase 1: Continental Shape
- Coarse SDF generation for coastal proximity detection.
- Detailed fbm coastline function (multi-octave, evaluated only near coast).
- Beach/shallow/deep ocean terrain transition in terrain worker.
- Impassable deep ocean boundary.
- Starting point computation.

### Phase 2: Climate Templates
- Template data structure (climate offsets, excluded/favored biomes, elevation profile).
- Verdania template (extract from existing Verdania design).
- Grausland and Petermark template stubs (playable but minimal).
- Template selection at world creation.
- Climate offset application in terrain worker before biome selection.

### Phase 3: Progression Banding
- Distance-from-start calculation available to mob spawner.
- Mob stat scaling by local progression level.
- Resource rarity scaling.

### Phase 4: Radial Objectives
- Objective placement algorithm.
- Objective types (start with Boss and Activate).
- Completion tracking in save file.
- Wayfinding UI (compass markers).

### Phase 5: Sailing Transition
- Sailing point placement and landmark.
- Completion gate check.
- Continent unload/load sequence with save/restore.
- Sailing animation with background generation.
- Convergence: all starting continents lead to shared continent 1.

### Phase 6: Settlements and Roads
- Settlement placement constrained to progression bands.
- Road network connecting settlements and objectives.
- Signpost system.

### Phase 7: Full Continental Identity
- Grausland and Petermark design documents (parallel to Verdania).
- Additional templates for continent 2+ (volcanic, tropical, archipelago).
- Climate drift across continent sequence.
- Named continents (integration with naming system).

---

## Relationship to Existing Design Documents

### Verdania

The existing Verdania design document describes a hand-authored continent with 14 zones, a golden path, and a 1–20 level range. The continental progression system refactors this:

- **Verdania becomes one of three continent 0 templates**, covering levels 1–10 (half its original range).
- The Verdania template constrains continent 0's generation: bay shape, temperate biome palette, pastoral elevation profile, settlement names from the Verdania naming palette.
- The zone system from Verdania (Haven, Frontier, etc.) maps to the sector/objective system: each zone becomes a wedge sector with appropriate objectives. The 14-zone structure compresses to ~5–7 sectors.
- Verdania's golden path (Haven → Frontier → Lake → fork → Crossroads → Borderlands) becomes the primary road from starting settlement → center → sailing point, with fork branches as secondary roads to sector objectives.

### Grausland and Petermark

These are new continent 0 templates that need their own design documents, parallel to Verdania's:

- **Grausland**: Nordic character. Cold biome palette. Steep terrain. Harsher early mobs. Narrative centered on survival and exploration of a hostile land. Needs its own naming palette, zone templates, and settlement archetypes.
- **Petermark**: Mediterranean/arid character. Warm biome palette. Flat terrain with mesas. Trade-oriented gameplay. Narrative centered on commerce, competing factions, and ruins in the sand. Needs its own naming palette, zone templates, and settlement archetypes.

Both should follow Verdania's document structure (geographic structure, zone assignments, road network, procedural levers) but express their own identity.

### World Generation Architecture

The World Generation Architecture document's two-phase generation model (Continental Genesis → Chunk Streaming) maps directly to this system. The continental metadata generated during Phase A now includes the coastline SDF, climate offsets from the template, objective placements, and the starting/sailing points. Phase B (chunk streaming) consumes this metadata as described in the Terrain Worker section.

---

## Open Questions

1. **XP curve across continents**: Should each continent's 10 levels require the same total XP, or should later continents require more? Constant XP per continent keeps pacing uniform; increasing XP extends playtime on harder continents.

2. **Equipment progression**: Do later continents introduce new equipment tiers, or does the player simply get stat-scaled versions of existing items? New tiers are more interesting but require more content.

3. **Returning to cleared continents**: When a player returns to continent 0 at level 30, should mobs scale to the player or remain level 1–10? Scaling removes the power fantasy; not scaling makes returns trivial.

4. **Multiplayer and convergence**: With peer-to-peer connections, do both players need to be on the same continent? If players chose different starting continents, convergence at continent 1 is the natural meeting point. Does continent 1 need to be generated before both players arrive, or can it generate on-demand?

5. **Continent count cap**: Is there a maximum continent index, or does the sequence extend indefinitely? Indefinite is simpler but risks content thinning at high levels.

6. **Starting continent replayability**: Can a player start a new world with a different starting continent to experience Grausland after completing Verdania? Or does the choice lock in for that WorldSeed? Allowing re-rolls with the same seed but different template choice is trivial since `ContinentSeed(0)` can incorporate the template ID.

7. **Convergence at continent 1 — narrative coherence**: If three different starting continents all lead to the same continent 1, does the arrival narrative need to account for where you came from? A simple solution: continent 1's starting dock has three piers, one per origin. The player arrives at the pier matching their starting continent, with a small flavor difference but identical gameplay from there.

8. **Template pool expansion**: When should new templates (volcanic, tropical, archipelago) enter the pool? Tied to continent index? Unlocked by player achievement? Always available but rare?

---

*End of Continental Progression Design Document*