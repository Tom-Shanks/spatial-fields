#!/usr/bin/env python3
"""Pack the Denver crown classification into a compact binary for the browser field.

Loads the trained pipeline (models/best_classifier.pkl) and the per-crown feature
table, predicts a management class for every crown, and writes
public/projects/denver-canopy/crowns.bin: little-endian records of
[x u16 (m from the study-area west edge), y u16 (m from the south edge),
 height_max u16 (dm), area u16 (m2), class u8, pad u8]. Absolute coordinates are
not written. crowns.json carries counts, extents and the class palette.

Run from the portfolio checkout, pointing at the denver_canopy project:
  python scripts/prepare-tree-field.py /path/to/denver_canopy
"""
import json, os, struct, sys
import numpy as np, pandas as pd

ROOT = sys.argv[1]
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "projects", "denver-canopy")

# Feature list mirrors pipeline.py FEATURE_COLS (kept in sync by hand).
S2_DATES = ['mar', 'may', 'jul', 'sep', 'nov']
S2_INDICES = ['NDVI', 'NDWI', 'EVI', 'RESWI', 'NDRE', 'NBR', 'CRI1']
S2_DELTAS = ['NDVI_spring_greenup', 'NDVI_summer_dev', 'NDVI_fall_senescence', 'NDVI_leafoff_drop', 'NDVI_amplitude', 'RESWI_spring', 'RESWI_leafoff']
FEATURE_COLS = (['R_mean', 'R_std', 'G_mean', 'G_std', 'B_mean', 'B_std', 'NIR_mean', 'NIR_std', 'NDVI_mean', 'NDVI_std', 'NDWI_mean', 'NDWI_std', 'EVI_mean', 'EVI_std']
                + ['height_mean', 'height_max', 'height_std', 'crown_volume'] + ['area_m2', 'perimeter', 'compactness']
                + ['S2_RESWI_mean', 'S2_RESWI_std', 'S2_NDVI_mean', 'S2_NDVI_std']
                + [f's2_{d}_{i}_{s}' for d in S2_DATES for i in S2_INDICES for s in ('mean', 'std')]
                + [f's2_delta_{d}_{s}' for d in S2_DELTAS for s in ('mean', 'std')])
CLASSES = ['Ash_EAB_Risk', 'Elm_DED_Risk', 'Conifer', 'Maple', 'Other_Deciduous']
LABELS = {'Ash_EAB_Risk': 'Ash (EAB risk)', 'Elm_DED_Risk': 'Elm (DED risk)', 'Conifer': 'Conifer', 'Maple': 'Maple', 'Other_Deciduous': 'Other deciduous'}

import sklearn._loss._loss, joblib  # noqa: E402
sys.modules['_loss'] = sklearn._loss._loss  # the pickle references the Cython loss module by a bare name
pipe = joblib.load(os.path.join(ROOT, 'models', 'best_classifier.pkl'))['pipe']
for _, step in getattr(pipe, 'steps', []):  # trained on an older scikit-learn; newer SimpleImputer expects _fill_dtype
    if type(step).__name__ == 'SimpleImputer' and not hasattr(step, '_fill_dtype'):
        step._fill_dtype = getattr(step, '_fit_dtype', np.float64)

df = pd.read_parquet(os.path.join(ROOT, 'processed', 'crown_features.parquet')).dropna(subset=FEATURE_COLS)
pred = pipe.predict(df[FEATURE_COLS].to_numpy(dtype=np.float64))
df['cls'] = pred

x0, y0 = df.centroid_x.min(), df.centroid_y.min()
df['xm'] = df.centroid_x - x0
df['ym'] = df.centroid_y - y0
os.makedirs(OUT_DIR, exist_ok=True)
buf = bytearray()
for r in df.itertuples():
    buf += struct.pack('<HHHHBB', min(65535, int(round(r.xm))), min(65535, int(round(r.ym))),
                       min(65535, int(round(r.height_max * 10))), min(65535, int(round(r.area_m2))), CLASSES.index(r.cls), 0)
open(os.path.join(OUT_DIR, 'crowns.bin'), 'wb').write(buf)
meta = {
    'records': int(len(df)), 'recordBytes': 10,
    'fields': ['x_m:u16', 'y_m:u16', 'height_dm:u16', 'area_m2:u16', 'class:u8', 'pad:u8'],
    'extentM': [float(df.xm.max()), float(df.ym.max())],
    'maxHeightM': float(df.height_max.max()), 'maxAreaM2': float(df.area_m2.max()),
    'classes': CLASSES, 'labels': LABELS,
    'counts': {c: int((df.cls == c).sum()) for c in CLASSES},
    'heightP99': float(df.height_max.quantile(.99)),
}
json.dump(meta, open(os.path.join(OUT_DIR, 'crowns.json'), 'w'), indent=2)
print(json.dumps(meta, indent=2), f'\n{len(buf)/1024:.0f} KB')
