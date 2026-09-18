# spatial-fields

Six interactive data visualizations from [tomshanks.dev](https://tomshanks.dev), each built from data I collected or processed myself. Components are React client components lifted from the site (Next.js 14, React 18, CSS modules). The original three fields use raw WebGL. The bat call and sound fields use Three.js, loaded on demand.

Every visualization animates with page scroll first, then hands control to the visitor: drag to rotate, arrow keys when focused, double-click or `R` to reset. Reduced-motion and no-WebGL fallbacks are handled in each component.

| Folder | Live | Data | What it shows |
|---|---|---|---|
| [`adsb-field/`](adsb-field) | [/projects/adsb-aircraft-tracker](https://tomshanks.dev/projects/adsb-aircraft-tracker) | 60,000 ADS-B position reports received on a single RTL-SDR in Denver, packed to 472 KB of local metre offsets | Bearing and distance around the receiver at rest; scrolls into an altitude column; free rotation on drag. Measured range from the full snapshot: max 131.92 km, p95 53.94 km, median 15.95 km. |
| [`canopy-strata/`](canopy-strata) | [/projects/denver-urban-tree-classification](https://tomshanks.dev/projects/denver-urban-tree-classification) | 18,272 tree crowns segmented from USGS 3DEP LiDAR and classified from NAIP + Sentinel-2 features, 180 KB | Plan view colored by class and sized by canopy area; on scroll the neighborhood tilts and separates into LiDAR-measured height strata (0–6, 6–12, 12–18, 18+ m), each labeled with its real composition. |
| [`received-surface/`](received-surface) | [/](https://tomshanks.dev/) | The 640 px visible-band METEOR-M2 4 image received 2026-09-14 (60 KB), sampled on the GPU into 25,625 points | The homepage hero. Every point is a received pixel; at rest it floats as a particle surface that answers the pointer, and scrolling resolves it back into the source frame. Raw WebGL, no library. |
| [`bat-survey/`](bat-survey) | [/projects/backyard-bat-survey](https://tomshanks.dev/projects/backyard-bat-survey) | 2,228 BatDetect2 call detections, one quantized three-second spectrogram, hourly aggregates, and one slowed audio clip | Three linked views: detections move from clock time into measured call shape, spectrogram amplitude lifts into relief, and a heatmap compares activity by hour and night. |

## What they do

| | | |
|:-:|:-:|:-:|
| ![ADS-B contacts: polar range at rest, altitude column on scroll](adsb-field/adsb-field.gif) | ![Canopy: plan view separating into LiDAR height strata](canopy-strata/canopy-strata.gif) | ![Received surface: point field resolving into the satellite image](received-surface/received-surface.gif) |
| `adsb-field` | `canopy-strata` | `received-surface` |

| ![Bat calls arranged by measured shape](bat-survey/data/field-b.webp) | ![Spectrogram amplitude mapped to display height](bat-survey/data/field-c.webp) | ![BatDetect2 detections by local hour and night](bat-survey/hour-heatmap.webp) |
| `bat-survey / call field` | `bat-survey / sound relief` | `bat-survey / hourly heatmap` |

## Using a component

Each folder is self-contained. Serve its `data/` directory as static files and point the component's fetch path at it. The site serves assets from `/projects/...`; those paths are the main site-specific part of the code.

```
npm i react react-dom three
```

`received-surface/ParticleSurface.tsx` needs only React: it compiles its own shaders and samples the image into a point grid at mount.

## Data provenance

- **ADS-B**: 1090 MHz broadcasts → RTL-SDR → readsb → SBS log → PostgreSQL/PostGIS. The packer samples 60,000 of 159,814 position reports and writes bearing/distance/altitude as local offsets only; no receiver coordinates are included.
- **Canopy**: crowns by watershed segmentation on the canopy-height model; class predictions from the trained pipeline (69.0% accuracy on a random split, 66.4% with whole city blocks held out). Local metre offsets only.
- **Received surface**: SatDump MSU-MR visible composite from a 65° METEOR-M2 4 pass, 137.9 MHz LRPT, Raspberry Pi 3B + RTL-SDR Blog V4, Denver. Downscaled to 640 px; no other processing.
- **Bat survey**: AudioMoth recordings at 250 kHz from seven nights in June 2026. BatDetect2 supplied the exported call measurements; the hourly view aggregates those detections. The sound relief uses one three-second clip with relative spectral level mapped to display height. Calls are not individual animals, and species identification remains probabilistic.

MIT. Tom Shanks, Denver.
