# canopy-strata

![Plan view separating into LiDAR height strata](canopy-strata.gif)

18,272 tree crowns in the Hale neighborhood of Denver, segmented from USGS 3DEP LiDAR and classified from NAIP and Sentinel-2 features. At rest it is a plan view: every crown is a point colored by predicted class and sized by canopy area; the red elm ribbons follow the streets. Scrolling tilts the neighborhood into an oblique view and separates it into four LiDAR-measured height strata (0–6, 6–12, 12–18, 18+ m), each labeled with what actually lives in it. Drag or arrow keys rotate; `R` resets. Vertical touch gestures scroll the page; horizontal ones rotate.

Live: https://tomshanks.dev/projects/denver-urban-tree-classification

## Files

| File | What |
|---|---|
| `TreeField.tsx` | React client component, raw WebGL. `compact` prop for small plates. |
| `canopy.module.css` | Layout, legend, strata labels, dark mode. |
| `prepare-tree-field.py` | Packer. Runs every crown through the trained pipeline and writes the data files. Includes the compatibility shims needed to load the older scikit-learn pickle. |
| `data/crowns.bin` | 18,272 × 10-byte little-endian records, 180 KB. |
| `data/crowns.json` | Field layout, extent, class names. |
| `data/strata.json` | Per-stratum counts, area and class mix, computed from the same records. |

## Record layout

```
x_m        u16   metres east of the study-area origin (extent 2,570 m)
y_m        u16   metres north (extent 2,218 m)
height_dm  u16   crown height from the canopy-height model, decimetres (max 45 m)
area_m2    u16   crown area (max 832 m²)
class      u8    index into crowns.json classes: ash (EAB risk), elm (DED risk), conifer, maple, other deciduous
pad        u8
```

Coordinates are local offsets only.

## What the classes mean

The classifier scored 69.0% on a random split and 66.4% with whole city blocks held out; the second number is the honest one, because neighbouring crowns are not independent. Orange (ash) marks crowns worth field screening for emerald ash borer, not confirmed species or infestation.
