# GolemCraft Visual Overhaul

*Art Direction and Terrain Variation — From photorealistic PBR to stylized painterly aesthetic with sub-biome diversity*

---

## 1. Problem Diagnosis

The current rendering pipeline is technically sound: terrain splatting with 4-texture blending, vertex AO, normal maps on desktop, day/night cycle with preset interpolation. The problem is art direction, not architecture.

Three issues compound into a visual result that falls short of the Valheim-style target:

- **Texture repetition.** 1024×1024 PolyHaven PBR textures contain photographic detail—specific leaf placements, pebble arrangements—that creates a recognizable fingerprint when tiled across 16×16 chunks. The eye detects these patterns instantly.
- **Style incoherence.** Photorealistic ground textures clash with stylized voxel geometry, blocky landmarks, and simple entity meshes. The combination creates an uncanny valley where nothing looks intentional.
- **Empty ground plane.** Without vegetation covering the terrain, every rendering shortcoming is exposed. Valheim's ground texture could be a 64×64 gradient and you'd barely notice—grass billboards occlude 80% of it.
- **Uniform biome zones.** Each biome maps to a single primary/secondary texture pair with one tint. Real landscapes contain internal variation—rocky outcrops in meadows, sandy hollows in forests, mud patches in plains. Without this, biome zones feel artificial and monotonous.

---

## 2. Target Aesthetic

The Valheim look emerges from four visual layers working together. Each layer is simple individually; the combination produces richness.

### Layer 1: Ground Plane

Low-detail, painterly ground textures at 256×256 resolution. These serve as the color base visible between vegetation. No photographic detail, no recognizable features. Essentially colored Perlin noise with a biome-appropriate palette. Biome tinting (already implemented) multiplies on top.

Generated procedurally at build time via a Node script using layered Perlin noise with hand-tuned color palettes. Seamless tiling is trivial with modular noise. No artist dependency for ground textures.

### Layer 2: Sub-Biome Variation

Within each biome zone, a secondary noise layer selects from 3–6 sub-biomes that override the parent's texture and tint locally. This creates patches of exposed rock on hillsides, sandy hollows in plains, muddy clearings in forests. The sub-biome layer makes all 8 base textures appear within a single biome zone, breaking visual monotony without adding new textures or shader complexity.

### Layer 3: Vegetation Billboards

Dense alpha-cutout billboards covering most of the ground surface. Grass tufts, flowers, small rocks, dead shrubs. Each is a pair of crossed quads (4 triangles, X-shape from above) with a 64×64 or 128×64 RGBA sprite. Wind animation via vertex shader displacement of top vertices. Vegetation type and density vary per sub-biome, not just per biome.

### Layer 4: 3D Objects

Low-poly trees (50–200 triangles), rocks, and landmarks. Already partially implemented via ObjectGenerator with instanced meshes. Trees need stylized silhouettes and wind sway to match the billboard vegetation layer.

---

## 3. What to Remove

| Remove | Reason | Savings |
|--------|--------|---------|
| **Normal maps (8×512²)** | Invisible under vegetation and with low-res textures | ~8 MB GPU memory, 1 texture sample/fragment |
| **PBR materials on terrain** | Matte ground (roughness 0.85, metalness 0.0) is visually identical to Lambert | ~30–40% cheaper fragment shader |
| **1024×1024 diffuse textures** | Replace with 256² procedural noise textures | ~60 MB → ~2 MB texture memory |
| **Complex splatting shader** | 4-texture blend with atlas UV math; simplify to tinted Lambert with 2-texture blend everywhere | Fewer ALU ops per fragment |

Total reclaimed budget: ~60 MB GPU memory and significant fragment shader headroom. This budget funds the vegetation billboard system.

---

## 4. Ground Texture Specification

### Resolution and Format

Target resolution: 256×256 pixels. Format: PNG, RGB (no alpha needed for ground). Stored in WebGL2 texture array as before, but at dramatically reduced resolution.

### Generation Method

Procedural at build time via kosmos-gen (see Section 13). The Texture Generator tab provides interactive controls for noise parameters, palette, and tiling preview. Export as PNG to GolemCraft's `public/textures/`. Run once, commit the PNGs.

### Art Style Guidelines

- No recognizable features—no individual leaves, pebbles, or cracks
- 8–12 color palette per texture, derived from noise value mapping
- Soft value variation (light/dark noise) for subtle depth
- Tiling must be seamless and undetectable
- Colors should be muted—the biome tint system adds saturation
- Think of these as what you see between grass blades: dirt, shadow, base color

### Texture Set (8 Base)

| Index | Name | Description | Base Palette | Character |
|-------|------|-------------|-------------|-----------|
| 0 | grass | Green-brown base | Muted olive, dark olive, earth brown | Soft noise, no blades |
| 1 | forest_floor | Dark brown-green | Dark umber, moss green, black-brown | Leaf litter impression |
| 2 | dirt | Warm brown | Earth brown, tan, dark sienna | Soft mottled |
| 3 | sand | Warm tan | Pale gold, warm beige, light brown | Uniform with slight value shift |
| 4 | rock | Gray stone | Cool gray, blue-gray, charcoal | Low-frequency noise |
| 5 | snow | Near-white | Blue-white, pure white, pale gray | Very subtle blue shadows |
| 6 | ice | Pale blue | Cyan-white, pale blue, white | Slight translucency feel |
| 7 | gravel | Speckled gray-brown | Warm gray, brown, dark gray | Stippled dots |

---

## 5. Sub-Biome System

### Concept

Each biome defines a list of sub-biomes—small-scale terrain patches that override the parent biome's texture pair and tint locally. A noise layer at higher frequency than the biome selection noise (0.08–0.15) selects which sub-biome applies at each vertex. The parent biome's climate selection (temperature × humidity × elevation) stays unchanged; sub-biomes only affect ground appearance and vegetation spawning.

The result: all 8 base textures appear within a single biome zone in geologically motivated patterns. A plains area might show grass, dirt, rock, sand, and gravel in natural-looking patches. Combined with per-sub-biome vegetation, this breaks repetition without adding new textures or shader complexity.

### Selection Method

Sub-biome selection combines two inputs:

**Noise-based selection.** A single sub-biome noise field (2–3 octaves, frequency 0.08–0.15) produces organic, blobby patch shapes. The noise value maps to cumulative weight thresholds to select a sub-biome. For example, if weights are [0.55, 0.20, 0.10, 0.10, 0.05], noise values 0.0–0.55 select the first sub-biome, 0.55–0.75 the second, and so on.

**Slope-driven overrides.** Some sub-biomes activate based on local terrain slope rather than noise. Steep slopes (gradient > threshold) force exposed rock. Low depressions force mud or sand. Height per vertex is already computed; slope is the gradient between neighboring vertices. Slope overrides take priority over noise selection when active.

The combination makes variation feel geological—rocky outcrops appear on steep hillsides, sandy patches collect in depressions, mud forms in low wet areas—rather than random splatter.

### Blending at Sub-Biome Boundaries

The existing 4-texture splatting shader already handles smooth blending. Sub-biome boundaries feed into the same blend weight system. At the transition between two sub-biomes, the noise value's proximity to the threshold produces a blend factor. For a threshold at 0.55, a noise value of 0.53 yields mostly the first sub-biome with some blending, while 0.57 yields mostly the second. No new shader work required.

### Data Structure

Each sub-biome entry specifies:

- **name** — identifier for debugging and vegetation lookup
- **weight** — relative frequency (weights within a biome sum to 1.0)
- **primary** — texture index (0–7) for the dominant ground texture
- **secondary** — texture index (0–7) for the blended texture
- **tint** — RGB tint override, or null to inherit parent biome tint
- **slopeOverride** — if true, this sub-biome activates on steep slopes regardless of noise
- **depressionOverride** — if true, this sub-biome activates in local height depressions
- **vegetation** — vegetation set reference (see Section 6)

### Sub-Biome Tables

#### Temperate Biomes

**Plains**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| grassland | 0.50 | grass | dirt | inherit | — | Default rolling grass |
| meadow_patch | 0.20 | grass | dirt | (0.25, 0.85, 0.3) | — | Brighter green, wildflowers |
| exposed_rock | 0.10 | rock | gravel | (0.6, 0.6, 0.6) | slope | Rocky hillocks, boulders |
| sandy_hollow | 0.10 | sand | dirt | (0.85, 0.8, 0.6) | depression | Dry sandy depressions |
| mud_patch | 0.10 | dirt | gravel | (0.4, 0.35, 0.25) | depression | Muddy low areas |

**Meadow**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| flower_field | 0.45 | grass | dirt | inherit | — | Dense wildflowers |
| tall_grass | 0.25 | grass | dirt | (0.3, 0.75, 0.25) | — | Tall swaying grass |
| bare_earth | 0.10 | dirt | grass | (0.5, 0.4, 0.3) | — | Trampled or grazed patches |
| rocky_knoll | 0.10 | rock | grass | (0.55, 0.55, 0.5) | slope | Stone outcrops with lichen |
| stream_bank | 0.10 | gravel | dirt | (0.5, 0.5, 0.45) | depression | Pebbly stream edges |

**Autumn Forest**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| leaf_carpet | 0.45 | forest_floor | dirt | inherit | — | Thick fallen leaves |
| mossy_clearing | 0.20 | grass | forest_floor | (0.4, 0.55, 0.25) | — | Green moss patches |
| exposed_root | 0.15 | dirt | forest_floor | (0.5, 0.35, 0.2) | — | Bare earth, tree roots |
| rocky_shelf | 0.10 | rock | forest_floor | (0.5, 0.5, 0.45) | slope | Flat rock slabs |
| mushroom_ring | 0.10 | forest_floor | dirt | (0.35, 0.3, 0.2) | — | Dark loamy soil |

**Deciduous Forest**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| forest_floor | 0.45 | forest_floor | dirt | inherit | — | Leaf litter, shade |
| fern_glade | 0.20 | grass | forest_floor | (0.25, 0.5, 0.2) | — | Ferns in dappled light |
| bare_soil | 0.15 | dirt | forest_floor | (0.4, 0.3, 0.2) | — | Dense canopy, bare ground |
| mossy_rock | 0.10 | rock | grass | (0.4, 0.45, 0.35) | slope | Moss-covered boulders |
| fallen_log | 0.10 | forest_floor | dirt | (0.3, 0.25, 0.15) | — | Rotting wood debris |

**Swamp**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| murky_grass | 0.35 | grass | dirt | inherit | — | Dark wet grass |
| mud_flat | 0.25 | dirt | gravel | (0.3, 0.25, 0.15) | depression | Thick dark mud |
| standing_water | 0.15 | dirt | dirt | (0.15, 0.2, 0.15) | depression | Very dark, saturated |
| reed_bank | 0.15 | grass | sand | (0.25, 0.35, 0.2) | — | Reedy marsh edges |
| dry_hummock | 0.10 | grass | rock | (0.35, 0.45, 0.25) | — | Raised dry ground |

#### Hot/Arid Biomes

**Desert**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| sand_dune | 0.45 | sand | sand | inherit | — | Open sandy terrain |
| rocky_flat | 0.20 | rock | sand | (0.7, 0.65, 0.5) | — | Wind-scoured stone |
| gravel_wash | 0.15 | gravel | sand | (0.75, 0.7, 0.55) | depression | Dry wash/wadi |
| cracked_earth | 0.10 | dirt | sand | (0.8, 0.7, 0.45) | — | Dried clay patches |
| boulder_field | 0.10 | rock | gravel | (0.6, 0.55, 0.45) | slope | Scattered large rocks |

**Red Desert**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| red_sand | 0.45 | sand | rock | inherit | — | Orange-red terrain |
| red_rock | 0.25 | rock | sand | (0.8, 0.35, 0.2) | slope | Red stone outcrops |
| gravel_plain | 0.15 | gravel | sand | (0.7, 0.4, 0.25) | — | Stony flat ground |
| dust_hollow | 0.15 | sand | dirt | (0.85, 0.5, 0.3) | depression | Fine dust collection |

**Savanna**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| dry_grass | 0.45 | grass | sand | inherit | — | Yellow-tan tall grass |
| bare_earth | 0.20 | dirt | sand | (0.7, 0.55, 0.3) | — | Dusty bare patches |
| termite_mound | 0.10 | dirt | rock | (0.65, 0.5, 0.3) | — | Hard-packed earth |
| watering_hole | 0.10 | dirt | gravel | (0.5, 0.4, 0.25) | depression | Muddy depressions |
| rocky_kopje | 0.15 | rock | sand | (0.6, 0.55, 0.4) | slope | Exposed granite domes |

**Badlands**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| mesa_rock | 0.40 | rock | sand | inherit | — | Red-orange stone |
| sand_wash | 0.20 | sand | gravel | (0.8, 0.5, 0.3) | depression | Sandy canyon floors |
| cliff_face | 0.20 | rock | rock | (0.65, 0.3, 0.15) | slope | Steep exposed layers |
| gravel_slope | 0.20 | gravel | rock | (0.7, 0.4, 0.25) | — | Loose scree |

#### Tropical Biomes

**Jungle**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| dense_canopy | 0.40 | forest_floor | dirt | inherit | — | Dark, shaded floor |
| vine_clearing | 0.20 | grass | forest_floor | (0.2, 0.45, 0.15) | — | Bright green openings |
| mud_path | 0.15 | dirt | forest_floor | (0.25, 0.2, 0.1) | depression | Wet trampled earth |
| root_network | 0.15 | forest_floor | rock | (0.2, 0.3, 0.15) | — | Exposed root systems |
| rocky_stream | 0.10 | rock | gravel | (0.4, 0.4, 0.35) | depression | Mossy stream beds |

**Beach**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| dry_sand | 0.40 | sand | sand | inherit | — | Upper beach |
| wet_sand | 0.25 | sand | dirt | (0.8, 0.75, 0.6) | — | Darker near waterline |
| shell_scatter | 0.15 | sand | gravel | (0.9, 0.85, 0.7) | — | Shell and pebble patches |
| dune_grass | 0.10 | grass | sand | (0.5, 0.6, 0.3) | — | Grass-topped dunes |
| tide_pool | 0.10 | rock | sand | (0.6, 0.6, 0.55) | depression | Rocky pools |

#### Cold Biomes

**Taiga**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| pine_floor | 0.40 | forest_floor | snow | inherit | — | Needle litter, partial snow |
| snow_patch | 0.25 | snow | forest_floor | (0.9, 0.92, 0.95) | — | Open snow between trees |
| frozen_mud | 0.15 | dirt | ice | (0.4, 0.38, 0.35) | depression | Hard frozen ground |
| rocky_ridge | 0.10 | rock | snow | (0.5, 0.5, 0.5) | slope | Exposed ridge stone |
| moss_carpet | 0.10 | grass | forest_floor | (0.3, 0.4, 0.25) | — | Green moss on sheltered ground |

**Tundra**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| snow_field | 0.40 | snow | rock | inherit | — | Open wind-swept snow |
| permafrost | 0.25 | dirt | ice | (0.5, 0.48, 0.45) | — | Exposed frozen earth |
| rocky_flat | 0.15 | rock | gravel | (0.6, 0.58, 0.55) | slope | Wind-exposed stone |
| lichen_patch | 0.10 | grass | rock | (0.5, 0.55, 0.4) | — | Sparse ground cover |
| ice_pool | 0.10 | ice | snow | (0.75, 0.85, 0.95) | depression | Frozen melt pools |

**Glacier**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| blue_ice | 0.45 | ice | snow | inherit | — | Compressed glacial ice |
| snow_cover | 0.25 | snow | ice | (0.95, 0.97, 1.0) | — | Fresh snow on ice |
| crevasse_edge | 0.15 | ice | ice | (0.6, 0.75, 0.9) | slope | Deep blue cracks |
| moraine | 0.15 | gravel | rock | (0.5, 0.5, 0.5) | — | Rocky debris bands |

#### Mountain Biomes

**Mountains**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| bare_rock | 0.35 | rock | gravel | inherit | — | Gray exposed stone |
| scree_slope | 0.20 | gravel | rock | (0.55, 0.55, 0.5) | slope | Loose broken rock |
| alpine_grass | 0.15 | grass | rock | (0.35, 0.5, 0.25) | — | Hardy grass patches |
| snow_cap | 0.15 | snow | rock | (0.9, 0.92, 0.95) | — | Snow at high elevation |
| cliff_face | 0.15 | rock | rock | (0.5, 0.48, 0.45) | slope | Steep dark stone |

**Volcanic**

| Sub-Biome | Weight | Primary | Secondary | Tint | Override | Character |
|-----------|--------|---------|-----------|------|----------|-----------|
| dark_basalt | 0.40 | rock | gravel | inherit | — | Near-black volcanic rock |
| ash_field | 0.25 | gravel | dirt | (0.3, 0.3, 0.3) | — | Gray volcanic ash |
| obsidian_flow | 0.15 | rock | rock | (0.15, 0.15, 0.15) | — | Glassy black patches |
| sulfur_vent | 0.10 | sand | rock | (0.7, 0.65, 0.2) | — | Yellow mineral deposits |
| lava_crack | 0.10 | rock | dirt | (0.4, 0.15, 0.05) | — | Red-hot seams (future glow) |

### Sub-Biome Noise Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Frequency | 0.08–0.15 | Patches roughly 8–15 blocks across; larger than individual features, smaller than biome zones |
| Octaves | 2–3 | Enough for organic shapes without excessive computation |
| Lacunarity | 2.0 | Standard doubling |
| Persistence | 0.5 | Standard halving |
| Slope threshold | 0.3–0.5 (tunable) | Gradient magnitude above which slope overrides activate |
| Depression threshold | -2.0 relative to local average (tunable) | Height below local mean triggers depression overrides |

One noise sample per vertex. The sub-biome noise is independent from biome selection noise to avoid correlated patterns.

---

## 6. Vegetation Billboard System

### Architecture

The vegetation system extends the existing ObjectGenerator. Each chunk spawns vegetation instances based on the **sub-biome** at each spawn position, not just the parent biome. Vegetation uses InstancedMesh with a custom shader for wind animation and alpha cutout.

### Rendering

- **Geometry:** Two crossed quads per instance (X-shape from above). 4 triangles total. Provides volume from any camera angle.
- **Alpha test:** `alphaTest: 0.5` on the material. Pixels are fully opaque or fully discarded. No sorting required, proper depth writes, no transparency ordering issues.
- **Instancing:** One InstancedMesh per vegetation type per chunk. Each instance stores position, rotation, scale, and color variation via instance attributes. Target: 5,000–10,000 instances visible at once, rendered in 4–8 draw calls.
- **Wind:** Vertex shader displaces top vertices using `sin(uTime + worldPosition.x * 0.5) * windStrength`. Bottom vertices are anchored. This creates a swaying motion with spatial variation so adjacent grass clumps move differently.
- **Distance culling:** Vegetation renders within 30–40 meters of the camera. Beyond that, the ground texture and fog handle the visual. The existing `ObjectGenerator.updateObjectVisibility()` pattern applies.

### Per-Sub-Biome Vegetation Sets

Vegetation sets are defined per sub-biome, not per parent biome. Each sub-biome references a named vegetation set. Multiple sub-biomes across different parent biomes can share the same set (e.g., "exposed_rock" in plains and "rocky_knoll" in meadow both use the "sparse_rock" vegetation set).

#### Vegetation Set Definitions

| Set Name | Types | Density | Height | Wind | Used By |
|----------|-------|---------|--------|------|---------|
| **lush_grass** | grass_tuft ×3, wildflower ×2 | High | 0.8–1.2 | Medium | plains/grassland, meadow/tall_grass |
| **flower_meadow** | grass_tuft ×2, flower ×3 | High | 0.6–1.0 | Medium | plains/meadow_patch, meadow/flower_field |
| **sparse_rock** | small_rock ×2, lichen ×1 | Very low | 0.2–0.4 | None | plains/exposed_rock, meadow/rocky_knoll, mountains/cliff_face |
| **sandy_sparse** | dead_bush ×1, dry_grass ×1 | Low | 0.3–0.5 | High | plains/sandy_hollow, desert/gravel_wash |
| **mud_sparse** | moss_clump ×1 | Very low | 0.1–0.3 | None | plains/mud_patch, swamp/mud_flat |
| **forest_understory** | fern ×2, undergrowth ×2 | Medium | 0.5–0.8 | Low | deciduous/forest_floor, deciduous/fern_glade, autumn/leaf_carpet |
| **forest_clearing** | grass_tuft ×1, fern ×1, wildflower ×1 | Medium | 0.4–0.7 | Medium | autumn/mossy_clearing, deciduous/bare_soil |
| **mushroom_patch** | mushroom ×2, dead_leaf ×2 | Medium | 0.3–0.5 | None | autumn/mushroom_ring, deciduous/fallen_log |
| **swamp_reeds** | reed ×2, moss_clump ×2 | Medium | 0.6–1.2 | Low | swamp/murky_grass, swamp/reed_bank |
| **swamp_dry** | dead_bush ×1, grass_tuft ×1 | Low | 0.4–0.7 | Medium | swamp/dry_hummock |
| **desert_sparse** | dead_bush ×2, dry_grass ×1 | Low | 0.3–0.6 | High | desert/sand_dune, desert/cracked_earth |
| **desert_rocky** | small_rock ×2 | Very low | 0.2–0.4 | None | desert/boulder_field, red_desert/red_rock |
| **dry_grass** | dry_grass ×3, dead_stalk ×1 | Medium | 1.0–1.8 | High | savanna/dry_grass, savanna/termite_mound |
| **savanna_sparse** | dry_grass ×1, small_rock ×1 | Low | 0.5–1.0 | High | savanna/bare_earth, savanna/watering_hole |
| **jungle_dense** | broad_leaf ×2, fern ×2, vine ×1 | Very high | 0.8–1.5 | Low | jungle/dense_canopy, jungle/vine_clearing |
| **jungle_floor** | fern ×1, moss_clump ×1 | Medium | 0.4–0.8 | Low | jungle/root_network, jungle/mud_path |
| **beach_grass** | beach_grass ×2, shell ×1 | Low | 0.4–0.7 | High | beach/dune_grass, beach/shell_scatter |
| **beach_bare** | shell ×1 | Very low | 0.1–0.2 | None | beach/dry_sand, beach/wet_sand |
| **taiga_floor** | snow_grass ×2, small_fir ×1 | Low | 0.4–0.8 | Medium | taiga/pine_floor, taiga/moss_carpet |
| **snow_sparse** | dead_shrub ×1 | Very low | 0.2–0.4 | High | taiga/snow_patch, tundra/snow_field |
| **tundra_lichen** | lichen ×2, dead_shrub ×1 | Very low | 0.2–0.4 | High | tundra/lichen_patch, tundra/permafrost |
| **alpine_hardy** | alpine_grass ×1, small_rock ×1 | Very low | 0.3–0.5 | High | mountains/alpine_grass |
| **gravel_bare** | small_rock ×1 | Very low | 0.1–0.3 | None | mountains/scree_slope, glacier/moraine, badlands/gravel_slope |
| **none** | — | None | — | — | glacier/blue_ice, glacier/snow_cover, glacier/crevasse_edge, volcanic/obsidian_flow, volcanic/lava_crack |

Density levels map to approximate instances per chunk (16×16 blocks): Very low = 10–20, Low = 30–60, Medium = 80–120, High = 150–250, Very high = 300+.

### Sprite Art Requirements

Total unique sprites needed: approximately 20–25 across all biomes, since many are shared (grass_tuft appears in 5+ vegetation sets with different tinting).

| Sprite | Size | Variants | Notes |
|--------|------|----------|-------|
| grass_tuft | 128×64 | 3 silhouettes | Most-used sprite; neutral green, tinted per biome |
| dry_grass | 128×64 | 2 silhouettes | Taller, sparser; tan base color |
| wildflower | 64×64 | 2 colors | Small color accents; yellow and white |
| flower | 64×64 | 3 colors | Purple, pink, blue; meadow accents |
| fern | 64×64 | 2 silhouettes | Broad frond shape; forest floors |
| broad_leaf | 64×64 | 2 silhouettes | Tropical undergrowth |
| reed | 64×128 | 2 silhouettes | Tall, thin; swamp and water edges |
| dead_bush | 64×64 | 2 silhouettes | Bare branches; desert and tundra |
| dead_leaf | 64×64 | 3 silhouettes | Fallen leaf shapes; autumn forest |
| small_rock | 64×64 | 2 shapes | Gray pebble cluster; all biomes |
| lichen | 64×64 | 1 shape | Low flat patch; tundra and rock surfaces |
| moss_clump | 64×64 | 1 shape | Rounded mass; swamp |
| shell | 64×64 | 2 shapes | Beach decoration; white/tan |
| mushroom | 64×64 | 2 shapes | Small clusters; forest floors |
| alpine_grass | 64×64 | 1 silhouette | Short, tough; mountain patches |
| beach_grass | 128×64 | 2 silhouettes | Tall wispy; dune grass |
| snow_grass | 64×64 | 1 silhouette | Sparse frosted blades |
| undergrowth | 64×64 | 2 shapes | Low bushy mass; forest understory |
| vine | 64×128 | 1 shape | Hanging tendril; jungle |
| dead_stalk | 128×64 | 1 silhouette | Single dry stalk; savanna |
| small_fir | 64×128 | 1 shape | Billboard young fir tree; taiga |

Sprite guidelines: hard alpha edges only (every pixel fully opaque or fully transparent), 3–4 color values per sprite, neutral/desaturated colors (biome tint adds color), designed to be viewed at 1–2 world units tall.

### DALL-E Prompts for Sprites

**Grass tufts:**
"Pixel art sprite of a small grass tuft, 128x64 pixels, transparent background, hard edges, no anti-aliasing on edges, 4-5 shades of muted green, simple silhouette of grass blades, side view, game asset, stylized not realistic"

**Wildflower:**
"Pixel art sprite of a small wildflower with stem, 64x64 pixels, transparent background, hard edges, yellow petals, green stem, 3-4 colors only, simple silhouette, side view, game asset"

**Fern:**
"Pixel art sprite of a small fern frond, 64x64 pixels, transparent background, hard edges, muted green, simple curved leaf shape, 3-4 shades, side view, game asset"

**Dead bush:**
"Pixel art sprite of a small dead bush with bare branches, 64x64 pixels, transparent background, hard edges, brown and gray, 3 colors, sparse twiggy silhouette, side view, game asset"

**Dry grass:**
"Pixel art sprite of tall dry grass stalks, 128x64 pixels, transparent background, hard edges, tan and pale yellow, 3-4 colors, thin wispy blades, side view, game asset"

**Reed:**
"Pixel art sprite of cattail reeds, 64x128 pixels, transparent background, hard edges, green stems with brown tops, simple vertical silhouette, 4 colors, side view, game asset"

Note: DALL-E tends to produce soft alpha edges despite instructions. Clean up in Aseprite by thresholding alpha to 0 or 255.

---

## 7. Camera Adjustment

Lower the third-person camera from the current MOBA-style overhead position to a close shoulder view: 5–8 meters behind the character, 2–3 meters above. Effects:

- Ground is viewed at a grazing angle where texture detail matters less
- The world feels larger and more immersive
- Vegetation billboards only need to extend 30–40 meters, not the full view distance
- Fog becomes more atmospheric when viewed horizontally rather than top-down

---

## 8. Shader and Material Simplification

### Desktop and Mobile Unified

Use Lambert shading everywhere for terrain. The current branching between MeshStandardMaterial (desktop) and MeshLambertMaterial (mobile) collapses into a single path. The splatting shader simplifies to: sample 2 textures from the array, blend by weight, multiply by biome tint, apply Lambert lighting and fog.

### Vegetation Shader

A minimal custom ShaderMaterial for billboard vegetation:

- Vertex shader: instance transform, wind displacement on top vertices, pass UV and tint
- Fragment shader: sample RGBA texture, alpha test (discard if alpha < 0.5), multiply by instance tint, Lambert lighting, fog

---

## 9. Performance Budget

| Component | Before | After |
|-----------|--------|-------|
| Terrain texture memory | ~62 MB (8×1024² + 8×512²) | ~2 MB (8×256²) |
| Vegetation texture memory | 0 MB | ~2 MB (sprite atlas) |
| Terrain draw calls/chunk | 1–3 (surface + voxel + water) | 1–3 (unchanged) |
| Vegetation draw calls | 0 | 4–8 total (instanced) |
| Fragment shader cost | PBR + normal map + 4-tex splat | Lambert + 2-tex splat |
| Sub-biome noise cost | 0 | 1 noise sample per vertex (in worker) |
| **Total GPU memory** | **~62 MB** | **~4 MB** |

Net result: ~58 MB freed, 4–8 additional draw calls, simpler shaders, one additional noise sample per vertex in the terrain worker. Large net improvement, especially on iPad where VRAM is the primary constraint. The sub-biome noise computation happens in the web worker and adds negligible cost to terrain generation.

---

## 10. Implementation Phases

### Phase 1: Validate Direction (1 session)

Minimal changes to test the visual hypothesis before committing to full implementation.

1. Generate 8 procedural noise textures at 256² via kosmos-gen Texture Generator tab
2. Remove normal map loading and shader references
3. Switch desktop terrain to Lambert material
4. Lower camera position to shoulder height
5. Evaluate in-game: does the direction feel right?

### Phase 2: Sub-Biome Foundation (1–2 sessions)

1. Add sub-biome noise generation to terrainworker.js (single noise field, 2–3 octaves)
2. Implement slope calculation from height gradient between neighboring vertices
3. Add sub-biome selection logic: noise → weight thresholds → sub-biome entry
4. Implement slope and depression overrides
5. Feed sub-biome texture indices and tints into existing splatmap generation
6. Add sub-biome tables to biomesystem.js for 3–4 biomes (plains, forest, desert, mountains)
7. Test blending at sub-biome boundaries

### Phase 3: Vegetation Prototype (2–3 sessions)

1. Create 3 grass_tuft sprites (64×64, hard alpha cutout)
2. Implement crossed-quad billboard geometry generator
3. Add InstancedMesh vegetation to ObjectGenerator, reading sub-biome at each spawn position
4. Implement basic wind vertex shader
5. Test density and visual coverage in plains sub-biomes

### Phase 4: Full Biome Coverage (2–3 sessions)

1. Complete sub-biome tables for all 16 biomes
2. Create remaining sprite set (~20 sprites)
3. Wire vegetation sets to all sub-biome definitions
4. Add biome tint application to vegetation shader
5. Tune density, height, and wind parameters per vegetation set

### Phase 5: Polish (1–2 sessions)

- Replace procedural textures with hand-painted 256² versions if needed
- Add post-processing: bloom and color grading (desktop only)
- Implement height fog in terrain fragment shader
- iPad performance testing and density tuning
- Tune sub-biome noise frequency and slope thresholds for natural feel

---

## 11. Files Affected

| File | Changes |
|------|---------|
| `public/textures/*` | Replace 1024² PBR textures with 256² procedural noise; remove normal maps |
| `src/shaders/terrainsplat.js` | Remove normal map sampling, simplify to Lambert, 2-texture blend everywhere |
| `src/world/terrain/terrainchunks.js` | Remove PBR material creation, unify desktop/mobile material path |
| `src/loaders/texturearrayloader.js` | Remove normal map array loading |
| `src/world/terrain/biomesystem.js` | Add sub-biome definitions per biome; add vegetation set references |
| `src/workers/terrainworker.js` | Add sub-biome noise generation, slope calculation, sub-biome selection logic |
| `src/world/terrain/chunkdatagenerator.js` | Read sub-biome texture indices and tints for splatmap generation |
| **`src/shaders/vegetation.js`** | **NEW** — Billboard vertex/fragment shader with wind and alpha cutout |
| `src/world/objects/objectgenerator.js` | Add vegetation billboard spawning per chunk, sub-biome-aware density and type |
| `src/controls/` (camera files) | Adjust camera offset: lower and closer to character |
| **`public/textures/vegetation/*`** | **NEW** — Billboard sprite atlas (RGBA PNGs with hard alpha) |
| **`scripts/generate-textures.js`** | **REMOVED** — Replaced by kosmos-gen Texture Generator tab |

---

## 12. Biome Reference

### Texture Set (8 Base Textures)

| Index | Texture | Resolution | Used By |
|-------|---------|------------|---------|
| 0 | grass | 256×256 | Plains, Autumn, Savanna, Meadow, Swamp + sub-biomes |
| 1 | forest_floor | 256×256 | Deciduous, Jungle, Taiga + sub-biomes |
| 2 | dirt | 256×256 | Subsurface, paths, swamp + sub-biomes across all biomes |
| 3 | sand | 256×256 | Desert, Beach, Red Desert + sub-biomes |
| 4 | rock | 256×256 | Mountains, Badlands, Volcanic + slope overrides everywhere |
| 5 | snow | 256×256 | Tundra, peaks + cold sub-biomes |
| 6 | ice | 256×256 | Glacier, frozen water + cold sub-biomes |
| 7 | gravel | 256×256 | Riverbeds, scree + depression/path sub-biomes |

### Biome Distribution

Biome selection uses two noise-based axes (temperature × humidity) with elevation modifiers. Sub-biome selection operates independently within each biome zone.

```
         DRY                          WET
    ┌─────────────────────────────────────┐
HOT │  desert    red_desert   savanna    │
    │  badlands              jungle      │
    ├─────────────────────────────────────┤
MID │  plains    meadow      deciduous   │
    │  mountains             swamp       │
    ├─────────────────────────────────────┤
COLD│  tundra    taiga       glacier     │
    │  mountains(snow)                   │
    └─────────────────────────────────────┘
```

### Terrain Parameters by Biome

| Biome | baseHeight | heightScale | Tint (RGB) |
|-------|------------|-------------|------------|
| plains | 8 | 6 | (0.3, 0.8, 0.25) |
| meadow | 8 | 4 | (0.25, 0.9, 0.3) |
| autumn_forest | 9 | 6 | (0.85, 0.5, 0.2) |
| deciduous_forest | 10 | 7 | (0.4, 0.35, 0.25) |
| swamp | 5 | 3 | (0.3, 0.4, 0.25) |
| desert | 7 | 4 | (0.95, 0.85, 0.5) |
| red_desert | 8 | 5 | (0.9, 0.4, 0.2) |
| savanna | 7 | 5 | (0.8, 0.7, 0.3) |
| badlands | 12 | 15 | (0.75, 0.35, 0.2) |
| jungle | 10 | 8 | (0.2, 0.4, 0.15) |
| beach | 4 | 2 | (0.95, 0.9, 0.7) |
| taiga | 9 | 6 | (0.35, 0.4, 0.35) |
| tundra | 6 | 3 | (0.95, 0.98, 1.0) |
| glacier | 8 | 4 | (0.8, 0.9, 1.0) |
| mountains | 18 | 20 | (0.6, 0.6, 0.6) |
| volcanic | 15 | 18 | (0.25, 0.25, 0.25) |

---

## 13. kosmos-gen as Asset Pipeline

### Reframing

kosmos-gen evolves from a standalone map generator into GolemCraft's build-time asset manager. The spine-Voronoi map generation remains as one tab, but the tool's primary role becomes procedural asset creation, preview, and export. All procedural assets flow through kosmos-gen rather than scattered scripts.

### Architecture

kosmos-gen already has the right foundation: Vite dev server, tab-based editor UI, pure-function `src/` library with no DOM dependencies, and deterministic seed-based generation. Each asset type gets its own editor tab with interactive controls and real-time preview.

### Tab Structure

| Tab | Purpose | Output | Status |
|-----|---------|--------|--------|
| **Textures** | Ground texture generation | 256² PNG tiles (8 base textures) | New — Phase 1 priority |
| **Sprites** | Vegetation billboard preview | 64×64 / 128×64 RGBA PNGs | New — Phase 3 |
| **Monsters** | 3D mob viewer/editor | Low-poly mesh definitions | New — Future |
| **Buildings** | Voxel structure editor | Voxel volume data (JSON) | New — Future |
| **Terrain** | Spine-Voronoi map gen | Continental templates | Existing |
| **Biomes** | Biome + sub-biome parameter tuning | Biome config preview | New — Future |

### Texture Generator Tab (Phase 1 Priority)

Interactive controls for procedural ground texture generation:

- **Noise parameters:** Octave count (1–4), frequency, amplitude, lacunarity
- **Color palette:** Pick 3–5 colors per texture, noise maps to palette via gradient
- **Tiling preview:** Show 3×3 tiled grid to verify seamlessness
- **Biome tint preview:** Apply biome tint multiplier to see final in-game appearance
- **Sub-biome tint preview:** Show the same texture under different sub-biome tints side by side
- **Export:** Save as PNG to GolemCraft's `public/textures/` directory
- **Batch export:** Generate all 8 textures with current settings

The generator uses modular noise (wrap coordinates at texture boundaries) to guarantee seamless tiling. The palette mapping converts noise values [0,1] to a color gradient, avoiding recognizable features entirely.

### Sprite Preview Tab (Phase 3)

Preview billboard sprites in context:

- **Import:** Load RGBA PNGs (from DALL-E or hand-painted)
- **Crossed-quad preview:** Show the X-shape billboard from multiple angles
- **Tint preview:** Apply sub-biome tints to see color variation across different sub-biomes
- **Density preview:** Scatter N instances on a flat plane to judge coverage per vegetation set
- **Alpha check:** Highlight any semi-transparent pixels that should be hard cutout
- **Wind preview:** Animate the top-vertex displacement to tune sway

### Biome Preview Tab (Future)

Interactive sub-biome tuning:

- **Noise visualization:** Show sub-biome noise field as colored patches on a 2D terrain slice
- **Weight adjustment:** Drag sliders to adjust sub-biome weights and see patch sizes change
- **Slope/depression overlay:** Visualize where slope and depression overrides activate
- **Vegetation density map:** Color-code vegetation density per sub-biome across the terrain

### Monster Viewer Tab (Future)

Three.js viewport for previewing mob meshes:

- Load/display low-poly mob models
- Animation preview (walk, attack, idle)
- Color/tint variations per biome
- Export mesh data for GolemCraft entity system

### Building Editor Tab (Future)

Voxel editor for landmark structures:

- 3D voxel painting interface
- Palette of block types (stone, wood, mayan_stone, etc.)
- Preview with lighting
- Export as VoxelVolume data (compatible with existing landmark system)
- Template library for procedural variation

### Integration with GolemCraft

kosmos-gen runs as a development tool (localhost:5174). Asset files export directly to GolemCraft's `public/` directory structure. The workflow:

1. Open kosmos-gen in a browser tab alongside GolemCraft dev server
2. Generate/edit assets with interactive controls
3. Export to GolemCraft's `public/textures/` or `public/textures/vegetation/`
4. GolemCraft's Vite dev server hot-reloads the changed assets
5. See results immediately in-game

No build step coupling—kosmos-gen produces static files that GolemCraft consumes. The two projects remain independent repositories.

### Files in kosmos-gen

| File | Purpose |
|------|---------|
| `editor/tabs/textures.js` | **NEW** — Texture generator UI and canvas preview |
| `src/textures/noisegen.js` | **NEW** — Modular Perlin noise with palette mapping |
| `src/textures/palettes.js` | **NEW** — Predefined color palettes for 8 base textures |
| `editor/tabs/sprites.js` | **NEW** (Phase 3) — Sprite preview and validation |
| `editor/tabs/biomes.js` | **NEW** (Future) — Sub-biome parameter tuning and visualization |
| `editor/tabs/monsters.js` | **NEW** (Future) — Three.js mob viewer |
| `editor/tabs/buildings.js` | **NEW** (Future) — Voxel structure editor |

---

## 14. Future Expansion

### Phase 2 Biomes (require additional textures)

- Mushroom forest (giant fungi) — sub-biomes: spore field, mycelium network, cap clearing
- Corrupted/plaguelands (dead grass texture) — sub-biomes: corruption edge, dead center, residual life
- Crystal caverns (crystal texture) — sub-biomes: crystal cluster, smooth stone, gem vein
- Underwater variants (coral, kelp) — sub-biomes: sand floor, reef, kelp forest

### Phase 2 Textures

- mud (swamp sub-biome enhancement)
- volcanic_rock (cracked, glowing seams for volcanic sub-biomes)
- corrupted_ground (purple/gray)
- cobblestone (ruins, paths — potential sub-biome for settled areas)

---

## 15. Open Questions

- Should vegetation billboards cast shadows? Adds visual quality but costs draw calls for shadow pass. Recommend: no shadows for grass, optional for larger flora like reeds.
- Should vegetation density scale with device capability? Could use the existing isMobile flag to halve density on iPad.
- Tree models: upgrade existing ObjectGenerator trees to stylized low-poly with wind, or defer to a later phase?
- Texture creation workflow: Viggo hand-paints sprites in Aseprite, or generate via DALL-E and clean up?
- Sub-biome noise frequency: should it be configurable per biome, or use a single global frequency? Per-biome frequency would let forests have larger patches while deserts have smaller ones, but adds complexity.
- Should sub-biomes affect height generation? Currently proposed as visual-only (textures + vegetation). Allowing sub-biomes to modulate heightScale slightly could create subtle terrain undulation within biome zones, but risks collision/mesh consistency issues.
- Depression detection: local average over what radius? Smaller radius (4–8 blocks) creates many small patches; larger radius (16–32 blocks) creates fewer, larger formations. Needs tuning.