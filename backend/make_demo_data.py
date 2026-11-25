"""Creates SYNTHETIC demo data (data/crop_yield.csv) so you can try the app right away.
These numbers are made up - for the real project, download the Kaggle dataset
'Crop Yield in Indian States' and save it as data/crop_yield.csv instead."""
import os, numpy as np, pandas as pd
rng = np.random.default_rng(42)
crops = {"Rice": (2.2, 1200), "Wheat": (3.0, 700), "Maize": (2.8, 800), "Cotton": (0.5, 700),
         "Sugarcane": (60, 1300), "Groundnut": (1.1, 700), "Soybean": (1.0, 900), "Potato": (20, 600)}
states = ["Punjab", "Maharashtra", "Uttar Pradesh", "Karnataka", "Gujarat", "Madhya Pradesh", "Tamil Nadu", "West Bengal"]
seasons = ["Kharif", "Rabi", "Whole Year"]
rows = []
for _ in range(3000):
    crop = rng.choice(list(crops)); base, rain0 = crops[crop]
    area = float(rng.lognormal(7, 1)); rain = float(np.clip(rng.normal(rain0, rain0 * .3), 200, 3500))
    fert_ha = float(rng.gamma(4, 30)); pest_ha = float(rng.gamma(2, .4)); year = int(rng.integers(1997, 2020))
    y = base * (.55 + .45 * min(rain / rain0, 1.3)) * (1 + .25 * np.tanh(fert_ha / 150)) * (1 + .01 * (year - 1997)) * rng.lognormal(0, .15)
    rows.append([crop, year, rng.choice(seasons), rng.choice(states), round(area, 1), round(y * area, 1),
                 round(rain, 1), round(fert_ha * area, 1), round(pest_ha * area, 2), round(y, 3)])
cols = ["Crop", "Crop_Year", "Season", "State", "Area", "Production", "Annual_Rainfall", "Fertilizer", "Pesticide", "Yield"]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "crop_yield.csv")
pd.DataFrame(rows, columns=cols).to_csv(out, index=False); print("Wrote", out)
