# Radial Continental Structure

**Version:** 1.0  
**Status:** Design  
**Depends on:** Continental Progression System, Biome System  
**Extends:** Continental Progression (climate templates, progression banding, radial objectives)

---

## Core Insight

A finite continent with a known center and a known starting point provides a **polar coordinate frame** — `(r, θ)` relative to a chosen origin — that every chunk can evaluate locally in O(1). This is not a global generation pass. It is two vec2 values (center, start) in the continental metadata, plus a scalar (baseRadius). Any terrain worker can compute `r = dist(block, origin)` and `θ = atan2(block - origin)` without inter-chunk communication.

This frame enables large-scale spatial structure — geographic climate logic, elevation envelopes, themed zones, river networks, road topology — while preserving the "procedural first, all local" philosophy. Noise systems remain unchanged. The radial frame *modulates their inputs*, biasing what the noise produces without replacing it.

### Two Origins

Two points matter:

- **Center**: The geometric center of the continent. Defines `distFromCenter` used for the coastline SDF, elevation envelope, and continental shape.
- **Start**: The player's starting position on the coast. Defines `distFromStart` used for progression banding, zone numbering, road hierarchy, and settlement density.

Most systems use `distFromStart` and `angleFromStart` because the player's experience radiates outward from where they arrive. The coastline and elevation envelope use `distFromCenter` because they describe the continent's physical shape.

Where this document says "origin" without qualification, it means the start point.

---

## Climate Geography

### Problem

The current biome system selects biomes from temperature and humidity noise, producing spatially incoherent patchwork. Desert appears next to tundra. There is no geographic logic — no windward/leeward, no latitude effect, no coastal moderation.

Continental templates (Continental Progression §Starting Continents and Climate) address this partially by clamping temperature and humidity ranges. But clamping is uniform across the continent. It cannot produce "the west coast is wet, the interior is dry" or "the north is warm, the south is cold."

### Solution: Spatially-Varying Climate Modulation

Each continent generates a **climate orientation** from its seed: a set of directional biases applied to temperature and humidity as functions of `(r, θ)`. These biases compose with the existing template offsets and clamping.

#### Continental Climate Parameters

Derived deterministically from `hash(ContinentSeed, "climate")`:

```
windAngle       = hash(seed, "wind")     → [0, 2π]    // prevailing wind direction
warmAngle       = hash(seed, "warm")     → [0, 2π]    // "equatorward" direction
```

These two angles define the continent's climate geometry. They need not align — a continent can have wind from the west and warmth from the south, or any other combination.

#### Temperature Field

```
baseTemp(x, z)       = tempNoise(x, z)                           // existing noise
latitudeEffect(x, z) = dot(normalize(pos - center), warmDir)     // [-1, 1]
coastalEffect(x, z)  = smoothstep(0, 0.4, distFromCoast / baseRadius)  // 0 at coast, 1 inland

effectiveTemp(x, z)  = baseTemp
                      + template.tempOffset
                      + latitudeEffect * latitudeStrength         // ~0.15–0.25
                      + coastalModeration * (1 - coastalEffect)   // coast is moderate
                      clamped to template.tempRange
```

The `latitudeEffect` creates a warm-to-cold gradient across the continent. The `coastalEffect` moderates temperature extremes near the coast (maritime climate). Inland areas experience the full temperature range; coastal areas are pulled toward the median.

**`latitudeStrength`** is ~0.15–0.25, enough to bias biome selection without overriding it. A block in the "warm" half of the continent might get +0.15 to temperature, shifting it from taiga to deciduous forest — not from tundra to desert. The noise still provides local variation.

#### Humidity Field

```
baseHumidity(x, z)     = humidityNoise(x, z)                     // existing noise
windwardEffect(x, z)   = dot(normalize(pos - center), windDir)   // [-1, 1]
elevationDrying(x, z)  = smoothstep(0.4, 0.8, normalizedElevation) * -0.2  // mountains are drier above treeline

effectiveHumidity(x, z) = baseHumidity
                         + template.humidityOffset
                         + windwardEffect * windwardStrength      // ~0.1–0.2
                         + elevationDrying
                         clamped to template.humidityRange
```

The `windwardEffect` creates a wet windward coast and a dry leeward interior — the rain shadow pattern. Combined with the latitude gradient, this produces recognizable geographic logic: wet tropical coast on the warm windward side, dry scrubland in the cold leeward interior.

#### Result

A continent with `warmAngle = south` and `windAngle = west` would produce:

- **Southwest coast**: Warm and wet → jungle, swamp
- **Southeast coast**: Warm and moderate → savanna, deciduous forest
- **Northwest coast**: Cool and wet → taiga, deciduous forest
- **Northeast interior**: Cold and dry → tundra, badlands
- **Center**: Moderate, blended → plains, meadow

This feels geographic rather than random, while still varying between continents because `warmAngle` and `windAngle` change with each seed.

### Interaction with Templates

The spatially-varying modulation composes with template offsets. For Verdania (temperate, moderate):

- Template clamps temperature to [0.2, 0.8] — no extremes
- The latitude gradient still operates *within* that range, creating a cooler north and warmer south (or whichever orientation the seed produces)
- The result is a temperate continent with geographic structure, not a uniform temperate soup

For Grausland (cold, Nordic):

- Template pulls temperature down (-0.25 offset), clamps to [0.0, 0.5]
- The latitude gradient creates "relatively warmer" and "relatively colder" regions within that cold range
- The windward coast gets more precipitation → heavy snow vs dry tundra
- The result is a cold continent that still has internal variety

---

## Elevation Envelope

### Problem

Current terrain uses noise-based elevation that is statistically uniform. Mountains and lowlands appear anywhere. There is no large-scale elevation structure — no central highlands, no coastal plains, no highland plateaus.

### Solution: Radial Elevation Envelope

An elevation envelope defines the *maximum plausible height* as a function of `(r, θ)`. The existing height noise is then scaled by this envelope:

```
envelope(r, θ)    = envelopeCurve(r) * angularModulation(θ)
effectiveHeight   = baseHeight + heightNoise * heightScale * envelope(r, θ)
```

The envelope is a soft ceiling, not a hard clamp. It multiplies the noise amplitude. Where the envelope is 1.0, terrain generates at full scale. Where it is 0.3, mountains are suppressed to rolling hills. Where it is 0.0, terrain is flat at sea level (ocean).

#### Envelope Curves

Each template selects an envelope curve. Examples:

**Dome** (default): Highest at center, tapering to coast.
```
envelopeCurve(r) = smoothstep(1.0, 0.0, r / baseRadius) * peakMultiplier
```
Produces a central highland with coastal lowlands. Classic island shape.

**Caldera**: Ring of mountains surrounding a lower center.
```
envelopeCurve(r) = bell(r, ringRadius, ringWidth) * peakMultiplier
```
Produces a volcanic ring island with a flat or depressed interior.

**Mesa**: Flat high interior with sharp edges.
```
envelopeCurve(r) = plateau(r, mesaRadius, falloffWidth) * peakMultiplier
```
Produces a highland plateau — the missing terrain type. The interior is elevated but *flat*, with cliffs at the edges. Petermark's mesas use this at sub-continental scale.

**Spine**: A ridge crossing the continent (Verdania's southern mountains).
```
envelopeCurve(r, θ) = ridgeLine(θ, spineAngle, spineWidth) * distanceFromEdge(r)
```
Concentrates elevation along a directional band rather than radially.

#### Angular Modulation

The envelope varies with angle to avoid rotational symmetry:

```
angularModulation(θ) = 1.0 + angularNoise(θ, seed) * 0.3
```

This creates 3–5 lobes where mountains are higher and valleys where they are lower. A dome envelope with angular modulation produces a continent with a few major peaks and lower passes between them — rather than a uniform dome.

#### Highlands and Plateaus

The current system lacks plateaus because `heightScale` modulates amplitude around `baseHeight`. A block either has high amplitude (peaks) or low amplitude (plains). Plateaus require high *base* elevation with low *variation*.

The envelope can express this by separating base elevation from amplitude:

```
baseElevation(r, θ) = envelopeCurve(r) * baseElevationScale   // raises the floor
amplitudeScale(r, θ) = amplitudeCurve(r)                       // controls roughness

effectiveHeight = baseElevation + heightNoise * heightScale * amplitudeScale
```

A **plateau** has `baseElevation = high, amplitudeScale = low` — elevated and flat.  
A **mountain range** has `baseElevation = medium, amplitudeScale = high` — varied and peaky.  
**Coastal lowlands** have `baseElevation = low, amplitudeScale = low` — flat and near sea level.

This two-parameter envelope (floor + amplitude) is the key to producing highlands, mesas, and terraced terrain.

#### Coastal Mountains and Cliffs

The dome envelope alone would make all coasts low and gentle. To allow coastal mountains and sea cliffs:

- The angular modulation can push high-envelope lobes to the edge of the continent, creating mountain peninsulas that meet the sea
- The coastline transition (Continental Progression §Terrain Modulation Near Coast) only forces a beach where the inland biome is *not* already mountainous
- A template parameter `coastalCliffProbability` controls how often mountain-envelope lobes are allowed to extend to the coastline rather than tapering

The rule is: if the elevation envelope is high at a coastal block, the coastline transition uses cliff faces rather than beaches. The existing biome system already handles this — mountains at the coast produce rock surfaces.

---

## Zone System

### Concept

A **zone** is a named region of the continent that provides a distinct sense of place. Zones are the spatial unit the player experiences: they have names, allowable biome subsets, atmospheric character, and progression context. A zone is larger than a biome patch and smaller than the continent.

Zones correspond roughly to "WoW zones" — Westfall, Duskwood, Stranglethorn. The player sees the zone name when they enter. There is a sense of accomplishment in arriving at a new zone, especially when the name and atmosphere shift together.

### Zones vs Biomes

| Property | Biome | Zone |
|----------|-------|------|
| Scale | ~50–200 blocks | ~400–1000 blocks |
| Determined by | Climate noise (temperature, humidity, elevation) | Radial partitioning from start point |
| Content | Textures, tinting, object types | Allowable biome subset, atmosphere, naming, quests |
| Boundaries | Smooth blending via splatting | Perturbed wedge edges, optionally aligned with rivers/ridges |

A zone does not replace biomes. It *constrains* which biomes can appear within its boundaries. The "Thornwood" zone allows deciduous_forest, taiga, and swamp but excludes desert and tundra. The climate noise still selects among the allowed biomes, producing natural-looking variation within the zone's character.

### Zone Generation

Zones are generated as **perturbed wedges emanating from the start point**, not the center. This aligns zones with progression banding: the nearest zones are low-level, the farthest zones are high-level.

#### Step 1: Wedge Partitioning

Divide the angular space around the start point into K wedges:

```
K = zoneCount(continentIndex)     // 5–8 for continent 0, grows slightly with index
baseAngle[i] = startAngle + (i / K) * 2π
perturbedAngle[i] = baseAngle[i] + hash(ZoneSeed, i) * (0.3 / K) * 2π
```

The perturbation prevents perfectly regular wedges while keeping them roughly evenly spaced.

#### Step 2: Radial Banding

Each wedge is divided into 1–3 radial bands:

- **Inner band** (r < 0.35 * baseRadius from start): The zone nearest the start. Low-level content.
- **Mid band** (0.35–0.7 * baseRadius): The zone's main body. Mid-level content.
- **Outer band** (0.7–1.0 * baseRadius): The zone's frontier. High-level content.

Not every wedge uses all three bands. Some wedges have a single zone spanning coast to interior. Others split into a coastal zone and an inland zone. The split is determined by `hash(ZoneSeed, i, "split")`.

This produces 8–16 zones per continent, each with a distinct angular and radial position.

#### Step 3: Boundary Perturbation

Zone boundaries use perturbed lines rather than straight radial edges:

```
boundaryOffset(r, θ) = fbm(r * 0.01, θ * 3, BoundarySeed) * perturbationScale
```

The perturbation scale is ~50–100 blocks, enough to make boundaries feel natural without creating bizarre zone shapes. Where possible, boundaries align with terrain features:

- Rivers can serve as zone boundaries (see §Rivers)
- Ridge lines can serve as zone boundaries
- Elevation contours can serve as zone boundaries

The alignment is approximate — the perturbed wedge boundary is *attracted toward* the nearest river or ridge within a tolerance, not snapped to it.

### Zone Properties

Each zone carries:

| Property | Source | Description |
|----------|--------|-------------|
| `name` | NamingSeed + zone index | Displayed on entry. From naming palette (see verdania_naming_palette.md). |
| `subtitle` | Continent name | Shown below zone name: "Thornwood — Verdania" |
| `allowedBiomes` | Zone template | Subset of the 16 biomes. Climate noise selects within this subset. |
| `excludedBiomes` | Zone template | Biomes that never appear regardless of climate. |
| `atmospherePreset` | Zone template | Sky color tint, fog density, ambient light color. |
| `weatherProfile` | Zone template | Probability distribution over weather types (clear, rain, storm, snow, fog). |
| `progressionRange` | Radial position | Level range derived from `distFromStart`. |
| `mobTable` | Zone template + progression | Which mob types spawn, at what density. |
| `landmarkDensity` | Zone template | How many landmarks per unit area. |
| `settlementDensity` | Zone template | How many settlements. Inner zones are denser. |

### Zone Templates

Zone templates define the character of a zone independently of its position on the continent. A template like "Dense Forest" or "Coastal Wetland" can appear on any continent, assigned by the seed. The zone's radial position determines its level range; the template determines its flavor.

Example templates:

| Template | Allowed Biomes | Atmosphere | Character |
|----------|---------------|------------|-----------|
| Pastoral Lowland | plains, meadow, deciduous_forest | Warm golden light, light haze | Gentle, settled, farmland |
| Dense Forest | deciduous_forest, taiga, jungle | Dim filtered light, green tint | Enclosed, mysterious |
| Highland Plateau | plains, tundra, mountains | Clear air, blue sky, distant views | Open, windswept, exposed |
| Coastal Wetland | swamp, beach, plains | Misty mornings, gray-blue light | Marshy, atmospheric |
| Arid Scrubland | desert, savanna, badlands | Harsh sun, yellow tint, heat shimmer | Dry, sparse, hostile |
| Volcanic Waste | volcanic, badlands, mountains | Red-orange haze, dark sky | Dangerous, dramatic |
| Frozen Expanse | tundra, glacier, taiga | Blue-white light, snow particles | Harsh, beautiful, silent |
| Ancient Ruins | any (adapts to climate) | Slightly desaturated, motes in air | Archaeological, mysterious |

The climate geography (§Climate Geography) biases which biomes the noise produces, and the zone template filters the result. A "Dense Forest" zone in the warm half of the continent produces jungle and deciduous forest. The same template in the cold half produces taiga. The template provides narrative consistency ("this is a forest zone") while the climate provides geographic logic ("this forest matches its position").

### Zone Assignment

Each wedge/band slot is assigned a template from a pool. The assignment respects constraints:

- The starting zone is always a safe, settled template (Pastoral Lowland or equivalent)
- Adjacent zones should contrast (not two Dense Forests side by side)
- At least one zone per continent uses each major template category (forest, open, coastal, dangerous)
- The template pool is filtered by the continental template (Grausland doesn't get Tropical Reef)

Hand-authored continents (Verdania, Grausland, Petermark) can override zone assignment with specific templates matching their design documents. Verdania's "Haven" zone is a fixed Pastoral Lowland; "Thornwood" is a fixed Dense Forest. Procedural continents (index 1+) use seed-based assignment.

---

## Rivers

### Design Principles

Rivers flow from high ground to the coast. The radial frame guarantees a sensible flow direction: outward from the interior (increasing `distFromCenter`). Rivers need not follow straight radial lines — they meander — but their general trend is always seaward.

### Generation

#### Source Placement

River sources are placed at high-elevation points in the inner half of the continent:

```
sourceCount = 3 + hash(RiverSeed, "count") % 4     // 3–6 major rivers
sourceAngle[i] = hash(RiverSeed, i, "angle") * 2π
sourceRadius[i] = (0.2 + hash(RiverSeed, i, "r") * 0.3) * baseRadius  // inner 20–50%
```

Sources are placed where the elevation envelope is high. If a source lands in a low-envelope area, it is nudged toward the nearest high point.

#### Path Tracing

Each river traces a path from source to coast using a locally-evaluated rule:

```
nextPoint = currentPoint + stepSize * (outwardDir + noiseOffset)
outwardDir = normalize(currentPoint - center)       // generally seaward
noiseOffset = fbm(currentPoint, MeanderSeed) * meanderStrength
```

The path is traced at coarse resolution (~16-block steps) and stored as a polyline in the continental metadata. Fine detail (exact block placement, bank shapes) is computed locally by the terrain worker when it encounters a river segment in its chunk.

#### Tributaries

Major rivers gain tributaries at mid-radius:

```
for each major river:
    tributaryCount = 1 + hash(seed, riverIndex, "trib") % 3
    tributaryJoinRadius = majorRiver.radius * (0.4 + hash(...) * 0.3)
    tributarySourceAngle = majorRiver.angle + offset
```

Tributaries are shorter, narrower rivers that join the main river at a confluence point. They originate from secondary high points or ridge lines.

#### Width and Character

River width and character scale with distance from source:

| Distance from source | Width (blocks) | Character |
|---------------------|----------------|-----------|
| 0–20% | 1–2 | Mountain stream. Fast, narrow, waterfalls on elevation drops. |
| 20–50% | 3–5 | Upland river. Rapids where crossing ridges, pools in valleys. |
| 50–80% | 6–10 | Lowland river. Gentle meanders, fords, bridge sites. |
| 80–100% | 10–20 | Estuary. Wide, slow, tidal. Delta where meeting the coast. |

#### Waterfalls

Where a river path crosses a significant elevation drop (>5 blocks over a short horizontal distance), a waterfall generates. The elevation envelope and heightmap determine where these occur naturally. Waterfalls are both landmarks and audio features.

#### Rivers as Zone Boundaries

River polylines stored in continental metadata can serve as zone boundary attractors. When a zone boundary is within ~100 blocks of a river, the boundary curves to follow the river. This produces natural-feeling zone transitions: "cross the river to enter Thornwood."

### Storage

River polylines are stored in continental metadata as arrays of `(x, z)` control points plus width at each point. Total data per continent: ~500 bytes per river, ~3 KB for 6 rivers with tributaries. The terrain worker receives the river data and evaluates proximity/intersection per chunk.

---

## Settlements and Points of Interest

### Population Density Model

Settlement density follows a gradient tied to `distFromStart` and zone template:

```
populationDensity(pos) = baseDensity(zone.template)
                        * safetyFactor(distFromStart)
                        * flatnessFactor(localElevation)
                        * riverProximityBonus(distToRiver)
```

- **Safety factor**: High near start (lots of settlements), low at the frontier (sparse outposts)
- **Flatness factor**: Settlements prefer flat terrain. Mountains suppress settlements.
- **River proximity**: Settlements cluster near water. A bonus for positions within ~100 blocks of a river.

This produces the natural pattern: dense settled lowlands near the start, sparse frontier camps at the far side, with towns clustering along rivers and roads.

### Settlement Types

| Type | Size | Services | Placement |
|------|------|----------|-----------|
| City | 1 per continent | All services: bank, auction, trainers, flight master | Center or start zone |
| Town | 2–4 per continent | Most services: inn, vendors, quest givers, flight master | Zone hubs, road intersections |
| Village | 4–8 per continent | Basic services: inn, general vendor, quest giver | Along roads, near rivers |
| Hamlet | 6–12 per continent | Minimal: one NPC, a campfire, maybe a vendor | Off-road, in wilderness zones |
| Camp | 8–15 per continent | None: just a landmark | Frontier zones, near objectives |

Settlement count scales with continent index (larger continents support more settlements).

### Points of Interest

POIs are non-settlement landmarks that provide gameplay content:

| POI Type | Tied to | Description |
|----------|---------|-------------|
| Objective site | Radial objective | Boss arena, shrine, collection area. Part of progression. |
| Dungeon entrance | Zone template | Cave, ruin, temple. Instanced or open-world. |
| Vista point | Elevation envelope | Overlook position where terrain first reveals the interior. |
| Resource node | Biome + progression | Mining, herbalism, logging site. Scales with level. |
| Discovery | Zone template | Unique feature: ancient tree, meteor crater, hot spring. Named, provides XP on first visit. |
| Wayshrine | Road network | Fast travel point. Unlocked on discovery. |

### Placement Algorithm

Settlements and POIs are placed during continental metadata generation (not per-chunk):

1. Place the starting settlement at the start point
2. Place the center settlement near the continent center
3. Place objective sites at their radial positions (from Continental Progression §Radial Objectives)
4. Place towns at zone hubs (the centroid of each zone, snapped to the nearest flat/river-adjacent position)
5. Place villages along the road network (see §Roads), spaced by minimum distance
6. Place hamlets and camps in remaining zones, biased by population density model
7. Place POIs (vistas, discoveries, resource nodes) using density noise within zones

All placement is deterministic from the seed. Positions are stored in continental metadata as coordinate lists (~50 bytes per settlement/POI, ~2–3 KB total).

---

## Roads

### Design Principles

Roads connect settlements and objectives. They follow terrain intelligently: preferring flat ground, following rivers, crossing mountains at passes. Road quality reflects the civilization gradient — cobblestone near cities, dirt in the midlands, faint trails at the frontier.

### Road Network Generation

#### Primary Road

A single primary road connects start → center → sailing point. This is the backbone of the continent, equivalent to Verdania's Golden Path.

The path is computed as a weighted A* search on a coarse grid (~8-block resolution), where the cost function penalizes:

- Elevation change (steep = expensive)
- Water crossing (rivers = expensive unless at a bridge site)
- Distance (shorter is better)
- Distance from a straight line (prevent excessive wandering)

The primary road passes through or near the center settlement and at least one mid-progression town.

#### Secondary Roads

Secondary roads branch from the primary road to reach:

- Zone hub settlements (towns)
- Objective sites
- The sailing point (if not on the primary road)

Secondary roads use the same A* pathfinding but with relaxed straightness constraints (they can wander more).

#### Trails

Trails are informal paths that hint at content without providing easy access:

- Connect hamlets to the nearest road
- Lead toward dungeon entrances
- Approach vista points

Trails are generated as perturbed straight lines (no pathfinding), 1–2 blocks wide.

### Road Hierarchy

| Type | Width | Surface | Markers | Generation |
|------|-------|---------|---------|------------|
| Highway | 5–6 blocks | Cobblestone (near cities), gravel (elsewhere) | Milestones, signposts, lamp posts | Only on primary road near settlements |
| Road | 3–4 blocks | Gravel/dirt | Signposts at forks | Primary and secondary roads |
| Trail | 2 blocks | Worn dirt | Occasional cairns | Tertiary connections |
| Path | 1 block | Faint (slightly different grass tint) | None | Toward discoveries, hidden areas |

### Bridges

Where a road crosses a river, a bridge generates. Bridge type scales with road hierarchy and river width:

| Road × River | Bridge Type |
|-------------|-------------|
| Highway × wide river | Stone arch bridge, wide, railed |
| Road × medium river | Wooden bridge, functional |
| Trail × narrow stream | Log bridge or stepping stones |
| Path × any | Ford (shallow crossing point) |

Bridge positions are determined by the intersection of road polylines and river polylines in continental metadata.

### Storage

Road polylines are stored similarly to rivers: arrays of `(x, z)` control points plus width and surface type. The terrain worker renders road surfaces by checking proximity to road segments within its chunk. Total data: ~1–2 KB per road, ~10–15 KB for the full network.

---

## Implementation Architecture

### Continental Metadata

All radial structure is computed once during continental genesis and stored in a metadata object:

```
ContinentalMetadata {
    // Shape (from Continental Progression)
    center: vec2
    baseRadius: float
    coastlineSDF: lowResGrid

    // Origin and progression
    startPoint: vec2
    startAngle: float
    sailPoint: vec2

    // Climate geography (new)
    windAngle: float
    warmAngle: float
    latitudeStrength: float
    windwardStrength: float

    // Elevation envelope (new)
    envelopeCurve: enum (dome | caldera | mesa | spine)
    envelopeParams: { peakMultiplier, ringRadius, spineAngle, ... }
    angularModulationSeed: int

    // Zones (new)
    zones: [{
        wedgeAngleStart: float
        wedgeAngleEnd: float
        radialBandStart: float
        radialBandEnd: float
        template: string
        name: string
        allowedBiomes: string[]
        atmospherePreset: string
        weatherProfile: { ... }
    }]

    // Rivers (new)
    rivers: [{
        points: vec2[]      // coarse polyline
        widths: float[]     // width at each point
        tributaries: [{ points, widths }]
    }]

    // Settlements and POIs (new)
    settlements: [{
        position: vec2
        type: string        // city | town | village | hamlet | camp
        name: string
        zone: int           // zone index
    }]

    pois: [{
        position: vec2
        type: string
        name: string
        zone: int
    }]

    // Roads (new)
    roads: [{
        points: vec2[]
        widths: float[]
        surfaceType: string[]   // per-segment
        hierarchy: string       // highway | road | trail | path
    }]
}
```

Total metadata size estimate: ~30–50 KB per continent. Generated once, passed to terrain workers as part of chunk requests (or as a shared reference).

### Terrain Worker Changes

The terrain worker receives the full metadata (or a relevant subset per chunk). For each block, the worker:

1. Computes `(r, θ)` from center and from start
2. Evaluates the elevation envelope → modulates heightNoise amplitude and base elevation
3. Evaluates climate modulation (latitude, windward, coastal) → adjusts temp/humidity inputs
4. Determines the zone → filters allowable biomes
5. Selects biome via existing Whittaker lookup (with constrained inputs)
6. Checks river proximity → overrides surface to water/sand/gravel
7. Checks road proximity → overrides surface to road material
8. Checks coastline proximity → applies beach/ocean transition (existing)

Steps 1–4 are simple arithmetic (dot products, smoothstep, table lookups). They add negligible cost to chunk generation. Steps 5–8 are existing systems with minor modifications.

### Chunk-Local Evaluation

Every computation in this document is chunk-local. The terrain worker needs only:

- The continental metadata (constant across all chunks)
- The block's world coordinates

No chunk needs data from any other chunk. No global pass is required. The radial frame provides structure; the noise provides detail.

---

## Implementation Phases

This document extends the phasing in Continental Progression. New phases are interleaved with existing ones.

### Phase 1.5: Climate Geography

*After Continental Progression Phase 1 (continental shape), before Phase 2 (climate templates).*

- Generate `windAngle` and `warmAngle` from seed
- Implement spatially-varying temperature and humidity modulation in terrain worker
- Verify that biome distribution becomes geographically coherent
- Tune `latitudeStrength` and `windwardStrength` for good results

### Phase 2.5: Elevation Envelope

*After Phase 2 (climate templates), before Phase 3 (progression banding).*

- Implement elevation envelope with dome curve as default
- Add angular modulation to prevent rotational symmetry
- Implement the two-parameter envelope (base elevation + amplitude) for plateau support
- Add mesa and spine envelope curves for template variety
- Verify that coastal mountains and cliffs generate correctly

### Phase 3.5: Zone System

*After Phase 3 (progression banding), before Phase 4 (radial objectives).*

- Implement wedge partitioning from start point
- Implement radial banding within wedges
- Define zone templates with allowable biomes, atmosphere, weather
- Implement zone boundary perturbation
- Implement zone name display on entry
- Wire zone-specific atmosphere (sky tint, fog, ambient color)

### Phase 5.5: Rivers

*After Phase 5 (sailing transition), before Phase 6 (settlements and roads).*

- Implement river source placement from elevation envelope
- Implement river path tracing with meander noise
- Add tributary generation
- Implement river rendering in terrain worker (water surface, banks, width)
- Add waterfall detection at elevation drops
- Test river-zone boundary alignment

### Phase 6 (revised): Settlements, POIs, and Roads

*Replaces the original Phase 6 in Continental Progression.*

- Implement population density model
- Place settlements using density + flatness + river proximity
- Place POIs using zone templates and density noise
- Implement primary road pathfinding (A* on coarse grid)
- Implement secondary roads and trails
- Implement road rendering in terrain worker
- Implement bridges at road-river intersections
- Implement signpost system

---

## Relationship to Existing Documents

### Continental Progression

This document extends Continental Progression with spatial structure. It does not replace any existing systems. Specifically:

- **Coastline generation**: Unchanged. The coastline SDF and fbm detail function operate as specified.
- **Progression banding**: Unchanged. `distFromStart` still drives mob scaling and resource rarity.
- **Radial objectives**: Unchanged in mechanics. Objectives are now placed within specific zones and can reference zone context.
- **Sailing and transition**: Unchanged.
- **Climate templates**: Extended. Templates now include `windAngle`, `warmAngle`, and envelope curve in addition to existing offsets and clamping.
- **Settlements and roads**: Replaced by the more detailed system in this document.

### Verdania

Verdania's hand-authored zones (Haven, Thornwood, Saltwind Shore, etc.) map onto this system as fixed zone assignments within Verdania's template:

- The wedge partitioning produces angular sectors that correspond to Verdania's zones
- Verdania's template overrides the seed-based zone assignment with specific templates matching the design document
- The river system generates Verdania's lake-and-outlet pattern from parameters in the Verdania template
- The elevation spine (southern mountains) uses the spine envelope curve

This system generalizes what Verdania specifies by hand. Verdania's design document becomes a *specific configuration* of the radial structure rather than a separate system.

### Biome System

The biome system is unchanged. The 16 biomes, their textures, tints, and terrain parameters remain as specified in the Biomes document. The only change is to the *inputs* to biome selection: temperature and humidity are now spatially modulated before the Whittaker lookup, and zone templates can filter which biomes are selectable.

---

## Open Questions

1. **Zone count tuning**: How many zones feel right for a 2000-block radius continent? Too few (3–4) and zones are enormous; too many (12+) and they flash past. The 8–16 range proposed here needs playtesting.

2. **Zone boundary visibility**: Should zone boundaries be visible on the in-game map? WoW shows zone boundaries as lines. This aids navigation but reduces mystery. A compromise: show boundaries only for visited zones.

3. **River rendering performance**: River polylines in the terrain worker add per-block proximity checks. For 6 rivers with ~50 control points each, this is ~300 distance checks per block in the worst case. Spatial indexing (which river segments are near this chunk?) reduces this to ~5–10 checks. Needs profiling.

4. **Atmospheric transitions**: When the player crosses a zone boundary, should the atmosphere (sky color, fog) change abruptly or blend? Blending is more polished but requires tracking "how far into this zone am I" in the rendering loop. Abrupt changes are simpler and arguably more readable.

5. **Road surface rendering**: Roads require overriding the terrain surface texture along a polyline. This could use the existing splatting system (roads as an additional "biome" with cobblestone/dirt textures) or a separate overlay pass. The splatting approach is simpler but limits road texture variety.

6. **Template authoring workflow**: Hand-authored continents (Verdania, Grausland, Petermark) need a way to specify zone assignments, river parameters, and road topology as part of their template. A JSON-like configuration format within the template data structure would work, but the schema needs definition.

7. **Elevation envelope interaction with existing biomes**: Some biomes (mountains, badlands) have their own high `heightScale`. The envelope multiplies this. Need to ensure that a high-envelope area with a mountain biome doesn't produce unreasonably tall terrain (>64 blocks).

---

*End of Radial Continental Structure Design Document*