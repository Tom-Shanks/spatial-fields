# adsb-field

![Polar range at rest; altitude column on scroll](adsb-field.gif)

60,000 aircraft position reports received on one RTL-SDR in Denver, drawn as a WebGL point field. At rest each point sits at its bearing and distance from the receiver (rings every 33 km out to 132 km). As the page scrolls the field re-plots into a column where height is altitude above sea level; drag to rotate it, arrow keys when focused, double-click or `R` to reset. Reduced-motion users get the same two states without the tween. No WebGL: a static image is shown instead.

Live: https://tomshanks.dev/projects/adsb-aircraft-tracker

## Files

| File | What |
|---|---|
| `AdsbField.tsx` | React client component, raw WebGL, no dependencies. `compact` prop drops the axis labels for small plates. |
| `adsb.module.css` | Layout, labels, dark mode. |
| `prepare-adsb-field.py` | Packer. Reads the tracker's receiver-relative `altitude_vs_range` export and writes the two data files. |
| `data/contacts.bin` | 60,000 × 8-byte little-endian records, 472 KB. |
| `data/contacts.json` | Field layout, counts, plot extents. |

## Record layout

```
bearing_deg   u16   0–359, from true north
range_10m     u16   distance from the receiver in 10 m units (max 132 km)
altitude_10ft u16   pressure altitude in 10 ft units
category      u8    operator class from the 520,000-aircraft reference index
pad           u8
```

The source export contains 158,909 position reports. The packer retains all 699 records labeled `usaf` and all 617 labeled `army`, then selects 58,684 of 157,593 `civilian` records using random seed 7. This is not a uniform sample: category proportions in the rendered field must not be used to estimate traffic prevalence. These labels come from the reference index, not from identification by the receiver. The full snapshot measured max range 131.92 km, p95 53.94 km, median 15.95 km; these are separate from the rounded 132 km plot extent. Only receiver-relative values are stored.

## Pipeline behind the data

1090 MHz → RTL-SDR → readsb → SBS log → rsync → Python ingest → PostgreSQL/PostGIS (materialized views for the heavy spatial queries) → FastAPI → React/Leaflet. This component reads a static export of that database, so it needs no backend.
