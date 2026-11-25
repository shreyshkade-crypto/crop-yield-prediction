"""RULE-BASED advice. Thresholds come from the training data (crop percentiles) or
widely used general pH ranges. Each item says WHY it is shown. Not a precise prescription."""


def build(inp, stats, risk):
    recs = []
    add = lambda cat, title, why, level="info": recs.append(
        {"category": cat, "title": title, "why": why, "level": level, "source": "rule-based"})
    if stats:
        rain, fert = inp["rainfall"], inp["fertilizer"]
        if rain < stats["rain_p25"]:
            add("Irrigation", "Possible water stress - plan supplementary irrigation",
                f"Rainfall {rain:.0f} mm is below the lower quartile ({stats['rain_p25']:.0f} mm) "
                f"of records for this crop in the dataset.", "warning")
        elif rain > stats["rain_p75"]:
            add("Irrigation", "High rainfall - check drainage and waterlogging risk",
                f"Rainfall {rain:.0f} mm is above the upper quartile ({stats['rain_p75']:.0f} mm) "
                "for this crop in the dataset.", "info")
        else:
            add("Irrigation", "Rainfall is within the typical range for this crop",
                "Value lies between the 25th and 75th percentile of dataset records.", "success")
        if fert < stats["fert_p25"]:
            add("Fertilizer", "Fertilizer use is low compared with typical records",
                f"{fert:.0f} kg/ha vs median {stats['fert_p50']:.0f} kg/ha. Get a soil test "
                "before changing doses.", "info")
        elif fert > stats["fert_p75"]:
            add("Fertilizer", "Fertilizer use is high - possible over-application",
                f"{fert:.0f} kg/ha vs upper quartile {stats['fert_p75']:.0f} kg/ha. Extra input "
                "may not raise yield; verify with a soil test.", "warning")
    ph = inp.get("soil_ph")
    if ph is not None:
        if ph < 5.5:
            add("Soil", "Soil is strongly acidic", f"pH {ph} < 5.5; many crops suffer nutrient "
                "lock-up. Ask a local agronomist about liming.", "warning")
        elif ph > 8.0:
            add("Soil", "Soil is alkaline", f"pH {ph} > 8.0; micronutrient availability can drop.",
                "warning")
    if risk == "High":
        add("Crop planning", "Predicted yield is in the low band for this crop",
            "Prediction is below the 25th percentile of historical yields for this crop.", "warning")
    add("Note", "pH, temperature, humidity, soil type and irrigation are not model inputs",
        "The trained model uses crop, season, state, year, area, rainfall, fertilizer and "
        "pesticide only. Those extra fields only drive the rule-based advice above.", "info")
    return recs
