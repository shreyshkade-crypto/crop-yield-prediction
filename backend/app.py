"""Flask REST API: /api/health /api/options /api/predict /api/history /api/analytics ..."""
import csv, hashlib, hmac, io, json, os, secrets, sqlite3
import urllib.error, urllib.parse, urllib.request
import time
from datetime import datetime, timedelta, date
import joblib, pandas as pd
from dotenv import load_dotenv, set_key
from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
try:
    from flask_cors import CORS
except ImportError:  # not needed when the site is served by this same server
    CORS = None
import recommendations
from preprocess import CAT, NUM

load_dotenv()
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(HERE, "models"))
DB_PATH = "/tmp/crop_yield.db"
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
if CORS:
    CORS(
        app,
        origins=["https://crop-yield-prediction-frontend.vercel.app"],
        supports_credentials=True
    )
FRONT = os.path.join(os.path.dirname(HERE), "frontend")

MODEL, META = None, None
if os.path.exists(os.path.join(MODEL_DIR, "yield_model.joblib")):
    MODEL = joblib.load(os.path.join(MODEL_DIR, "yield_model.joblib"))  # trained by train_model.py
    META = json.load(open(os.path.join(MODEL_DIR, "metadata.json")))
AREA_TO_HA = {"hectare": 1.0, "acre": 0.404686}


def ok(data, code=200):
    return jsonify({"success": True, "data": data}), code


def fail(msg, code=400, details=None):
    return jsonify({"success": False, "error": msg, "details": details or {}}), code


@app.errorhandler(413)
def request_too_large(_error):
    return fail("Upload is too large. Crop photos must be 4 MB or smaller.", 413)


@app.errorhandler(Exception)
def unexpected_error(error):
    if isinstance(error, HTTPException):
        return fail(error.description, error.code or 500)
    app.logger.exception("Unhandled request error")
    return fail("An unexpected server error occurred. Please try again.", 500)


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH); c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS predictions(id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id INTEGER, created_at TEXT, crop TEXT, season TEXT, state TEXT, area_ha REAL, yield_t_ha REAL,
        production_t REAL, risk TEXT, inputs TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS farmers(
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        mobile TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS farmer_sessions(
        token_hash TEXT PRIMARY KEY, farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS farmer_fields(
        id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id INTEGER NOT NULL, name TEXT NOT NULL,
        state TEXT NOT NULL, district TEXT NOT NULL, village TEXT, area_ha REAL NOT NULL,
        soil_type TEXT, soil_ph REAL, created_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS farm_reminders(
        id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id INTEGER NOT NULL, field_id INTEGER,
        title TEXT NOT NULL, category TEXT NOT NULL, due_date TEXT NOT NULL, notes TEXT,
        completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS crop_health_cases(
        id INTEGER PRIMARY KEY AUTOINCREMENT, farmer_id INTEGER NOT NULL, field_id INTEGER,
        crop TEXT NOT NULL, symptom TEXT NOT NULL, possible_issue TEXT NOT NULL, guidance TEXT NOT NULL,
        notes TEXT, photo BLOB NOT NULL, photo_type TEXT NOT NULL, created_at TEXT NOT NULL)""")
    # Keep existing local databases usable while assigning new predictions to accounts.
    prediction_columns = {row[1] for row in c.execute("PRAGMA table_info(predictions)")}
    if "farmer_id" not in prediction_columns:
        c.execute("ALTER TABLE predictions ADD COLUMN farmer_id INTEGER")
    c.execute("""CREATE TABLE IF NOT EXISTS market_price_history(
        id INTEGER PRIMARY KEY AUTOINCREMENT, crop TEXT NOT NULL, state TEXT NOT NULL,
        district TEXT, market TEXT NOT NULL, variety TEXT, grade TEXT, price_date TEXT NOT NULL,
        min_price REAL, max_price REAL, modal_price REAL NOT NULL, captured_at TEXT NOT NULL,
        UNIQUE(crop,state,district,market,variety,grade,price_date))""")
    c.execute("""CREATE TABLE IF NOT EXISTS market_commodity_cache(
        state TEXT PRIMARY KEY, commodities TEXT NOT NULL, fetched_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS weather_cache(
        lat REAL NOT NULL, lon REAL NOT NULL, payload TEXT NOT NULL, fetched_at TEXT NOT NULL,
        PRIMARY KEY(lat,lon))""")
    return c


def farmer_payload(row):
    return {"id": row["public_id"], "name": row["name"], "mobile": row["mobile"]}


def password_digest(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def password_matches(password, encoded):
    try:
        algorithm, salt_hex, expected = encoded.split("$", 2)
        if algorithm != "pbkdf2_sha256": return False
        actual = password_digest(password, bytes.fromhex(salt_hex)).split("$")[-1]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_farmer_session(con, farmer_id):
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    con.execute("INSERT INTO farmer_sessions(token_hash,farmer_id,expires_at,created_at) VALUES(?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), farmer_id,
                 (now + timedelta(days=14)).isoformat(timespec="seconds"), now.isoformat(timespec="seconds")))
    return token


@app.before_request
def load_farmer_session():
    g.farmer = None
    if request.method == "OPTIONS":
        return None
    if not request.path.startswith("/api/"):
        return
    token = request.cookies.get("farmer_session", "")
    if token:
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with db() as con:
            row = con.execute("""SELECT f.* FROM farmer_sessions s JOIN farmers f ON f.id=s.farmer_id
                WHERE s.token_hash=? AND s.expires_at>?""", (token_hash, datetime.utcnow().isoformat(timespec="seconds"))).fetchone()
            if row:
                g.farmer = dict(row)
            else:
                con.execute("DELETE FROM farmer_sessions WHERE token_hash=?", (token_hash,))
    public_api = {"/api/health", "/api/options", "/api/auth/me", "/api/auth/register", "/api/auth/login"}
    if request.path not in public_api and g.farmer is None:
        return fail("Please log in to continue.", 401)


def set_session_cookie(response, token):
    secure_cookie = os.environ.get("COOKIE_SECURE")
    secure_cookie = request.is_secure if secure_cookie is None else secure_cookie.strip().lower() in {"1", "true", "yes", "on"}
    response.set_cookie("farmer_session", token, max_age=14 * 24 * 60 * 60,
                        httponly=True, secure=secure_cookie, samesite="Lax", path="/")
    return response


@app.get("/api/auth/me")
def auth_me():
    return ok(farmer_payload(g.farmer) if g.farmer else None)


@app.post("/api/auth/register")
def auth_register():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    mobile = "".join(ch for ch in str(payload.get("mobile", "")) if ch.isdigit())
    password = payload.get("password", "")
    errors = {}
    if len(name) < 2 or len(name) > 70: errors["name"] = "Enter your name (2 to 70 characters)."
    if not 10 <= len(mobile) <= 15: errors["mobile"] = "Enter a valid mobile number with 10 to 15 digits."
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        errors["password"] = "Use a password with at least 8 characters."
    if errors: return fail("Please correct the highlighted fields.", 422, errors)
    public_id = "FARM-" + secrets.token_hex(3).upper()
    now = datetime.utcnow().isoformat(timespec="seconds")
    try:
        with db() as con:
            cur = con.execute("INSERT INTO farmers(public_id,name,mobile,password_hash,created_at) VALUES(?,?,?,?,?)",
                              (public_id, name, mobile, password_digest(password), now))
            farmer_id = cur.lastrowid
            token = create_farmer_session(con, farmer_id)
            farmer = con.execute("SELECT * FROM farmers WHERE id=?", (farmer_id,)).fetchone()
    except sqlite3.IntegrityError:
        return fail("An account with this mobile number already exists. Log in instead.", 409, {"mobile": "This mobile number is already registered."})
    response, code = ok(farmer_payload(farmer), 201)
    return set_session_cookie(response, token), code


@app.post("/api/auth/login")
def auth_login():
    payload = request.get_json(silent=True) or {}
    mobile = "".join(ch for ch in str(payload.get("mobile", "")) if ch.isdigit())
    password = payload.get("password", "")
    with db() as con:
        farmer = con.execute("SELECT * FROM farmers WHERE mobile=?", (mobile,)).fetchone()
        if not farmer or not isinstance(password, str) or not password_matches(password, farmer["password_hash"]):
            return fail("Mobile number or password is incorrect.", 401)
        token = create_farmer_session(con, farmer["id"])
        con.execute("DELETE FROM farmer_sessions WHERE farmer_id=? AND expires_at<=?",
                    (farmer["id"], datetime.utcnow().isoformat(timespec="seconds")))
    response, code = ok(farmer_payload(farmer))
    return set_session_cookie(response, token), code


@app.post("/api/auth/logout")
def auth_logout():
    token = request.cookies.get("farmer_session", "")
    if token:
        with db() as con:
            con.execute("DELETE FROM farmer_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response, code = ok({"logged_out": True})
    response.delete_cookie("farmer_session", path="/", httponly=True, secure=request.is_secure, samesite="Lax")
    return response, code


@app.get("/api/fields")
def list_fields():
    with db() as con:
        rows = [dict(r) for r in con.execute("""SELECT id,name,state,district,village,area_ha,soil_type,soil_ph,created_at
            FROM farmer_fields WHERE farmer_id=? ORDER BY id DESC""", (g.farmer["id"],))]
    return ok(rows)


@app.post("/api/fields")
def create_field():
    p = request.get_json(silent=True) or {}
    name, state = str(p.get("name", "")).strip(), str(p.get("state", "")).strip()
    district, village = str(p.get("district", "")).strip(), str(p.get("village", "")).strip()
    errors = {}
    if not 2 <= len(name) <= 70: errors["name"] = "Field name should be 2 to 70 characters."
    if META and state not in META["categories"]["State"]: errors["state"] = "Choose a state from the list."
    if not 2 <= len(district) <= 80: errors["district"] = "Enter a district (2 to 80 characters)."
    try:
        area = float(p.get("area_ha", ""))
        if not 0.01 <= area <= 100000: raise ValueError
    except (TypeError, ValueError):
        area = None; errors["area_ha"] = "Enter field area in hectares (0.01 to 100,000)."
    soil_type = str(p.get("soil_type", "")).strip()[:80]
    try:
        soil_ph = None if p.get("soil_ph") in (None, "") else float(p["soil_ph"])
        if soil_ph is not None and not 3 <= soil_ph <= 10: raise ValueError
    except (TypeError, ValueError):
        soil_ph = None; errors["soil_ph"] = "Soil pH must be between 3 and 10."
    if errors: return fail("Please correct the field details.", 422, errors)
    with db() as con:
        cur = con.execute("""INSERT INTO farmer_fields(farmer_id,name,state,district,village,area_ha,soil_type,soil_ph,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)""", (g.farmer["id"], name, state, district, village or None, area,
            soil_type or None, soil_ph, datetime.utcnow().isoformat(timespec="seconds")))
        row = con.execute("""SELECT id,name,state,district,village,area_ha,soil_type,soil_ph,created_at
            FROM farmer_fields WHERE id=?""", (cur.lastrowid,)).fetchone()
    return ok(dict(row), 201)


@app.delete("/api/fields/<int:field_id>")
def delete_field(field_id):
    with db() as con:
        exists = con.execute("SELECT id FROM farmer_fields WHERE id=? AND farmer_id=?", (field_id, g.farmer["id"])).fetchone()
        if not exists: return fail("Field not found.", 404)
        con.execute("DELETE FROM farm_reminders WHERE field_id=? AND farmer_id=?", (field_id, g.farmer["id"]))
        con.execute("UPDATE crop_health_cases SET field_id=NULL WHERE field_id=? AND farmer_id=?", (field_id, g.farmer["id"]))
        con.execute("DELETE FROM farmer_fields WHERE id=? AND farmer_id=?", (field_id, g.farmer["id"]))
    return ok({"deleted": field_id})


@app.get("/api/reminders")
def list_reminders():
    with db() as con:
        rows = [dict(r) for r in con.execute("""SELECT r.id,r.field_id,r.title,r.category,r.due_date,r.notes,r.completed,
            f.name AS field_name FROM farm_reminders r LEFT JOIN farmer_fields f ON f.id=r.field_id AND f.farmer_id=r.farmer_id
            WHERE r.farmer_id=? ORDER BY r.completed ASC,r.due_date ASC,r.id DESC""", (g.farmer["id"],))]
    for row in rows:
        row["completed"] = bool(row["completed"])
        row["days_until"] = (date.fromisoformat(row["due_date"]) - date.today()).days
    return ok(rows)


@app.post("/api/reminders")
def create_reminder():
    p = request.get_json(silent=True) or {}
    title, category = str(p.get("title", "")).strip(), str(p.get("category", "Other")).strip()
    notes = str(p.get("notes", "")).strip()[:500]
    due_date = str(p.get("due_date", "")).strip()
    errors = {}
    if not 2 <= len(title) <= 100: errors["title"] = "Task name should be 2 to 100 characters."
    if category not in ("Sowing", "Irrigation", "Fertilizer", "Pest check", "Harvest", "Other"):
        errors["category"] = "Choose a valid task category."
    try: date.fromisoformat(due_date)
    except ValueError: errors["due_date"] = "Choose a valid task date."
    field_id = p.get("field_id") or None
    if field_id:
        try: field_id = int(field_id)
        except (TypeError, ValueError): errors["field_id"] = "Choose one of your saved fields."
        else:
            with db() as con:
                if not con.execute("SELECT 1 FROM farmer_fields WHERE id=? AND farmer_id=?", (field_id, g.farmer["id"])).fetchone():
                    errors["field_id"] = "Choose one of your saved fields."
    if errors: return fail("Please correct the reminder details.", 422, errors)
    with db() as con:
        cur = con.execute("""INSERT INTO farm_reminders(farmer_id,field_id,title,category,due_date,notes,created_at)
            VALUES(?,?,?,?,?,?,?)""", (g.farmer["id"], field_id, title, category, due_date, notes or None,
            datetime.utcnow().isoformat(timespec="seconds")))
        row = con.execute("""SELECT r.id,r.field_id,r.title,r.category,r.due_date,r.notes,r.completed,f.name AS field_name
            FROM farm_reminders r LEFT JOIN farmer_fields f ON f.id=r.field_id AND f.farmer_id=r.farmer_id WHERE r.id=?""", (cur.lastrowid,)).fetchone()
    result = dict(row); result["completed"] = bool(result["completed"])
    result["days_until"] = (date.fromisoformat(result["due_date"]) - date.today()).days
    return ok(result, 201)


@app.patch("/api/reminders/<int:reminder_id>")
def update_reminder(reminder_id):
    completed = (request.get_json(silent=True) or {}).get("completed")
    if not isinstance(completed, bool): return fail("Choose whether this reminder is complete.", 422)
    with db() as con:
        n = con.execute("UPDATE farm_reminders SET completed=? WHERE id=? AND farmer_id=?",
                        (int(completed), reminder_id, g.farmer["id"])).rowcount
    return ok({"id": reminder_id, "completed": completed}) if n else fail("Reminder not found.", 404)


@app.delete("/api/reminders/<int:reminder_id>")
def delete_reminder(reminder_id):
    with db() as con:
        n = con.execute("DELETE FROM farm_reminders WHERE id=? AND farmer_id=?", (reminder_id, g.farmer["id"])).rowcount
    return ok({"deleted": reminder_id}) if n else fail("Reminder not found.", 404)


DISEASE_GUIDANCE = {
    "yellowing": ("Nutrient, water or root stress", "Yellowing can have several causes. Check soil moisture, drainage and whether older or newer leaves are affected. Compare healthy plants nearby; use a soil test or ask a local KVK before applying fertilizer."),
    "white-powder": ("Possible powdery mildew", "White powder-like patches can be fungal, but dust and spray residue can look similar. Check whether patches spread on leaf surfaces. Keep leaves dry where practical and ask a local KVK to confirm before treatment."),
    "dark-spots": ("Possible leaf spot", "Dark lesions may be fungal or bacterial and can also follow weather or chemical injury. Avoid handling wet plants, note how quickly spots spread and get local confirmation before any spray."),
    "holes": ("Possible chewing pest", "Holes suggest feeding damage, but the insect may not be on the leaf now. Inspect the underside and nearby plants early in the day; identify the pest before choosing any control."),
    "wilting": ("Water, root or wilt-disease stress", "Check soil moisture and drainage, then inspect the stem base and roots on an affected plant. Sudden or spreading wilt needs prompt local agriculture advice; do not assume more water is the answer."),
    "curl-mosaic": ("Possible virus or sap-feeding pest", "Leaf curl or mosaic patterns can have several causes, including sap-feeding insects. Check nearby plants and leaf undersides, separate affected plants if practical, and request local confirmation before treatment."),
    "other": ("Cause not clear from symptoms", "Keep the photo and note when symptoms started, which leaves are affected and recent weather or spray use. A local KVK or agriculture officer can identify the cause from the plant and field conditions.")
}


@app.get("/api/crop-health")
def list_crop_health_cases():
    with db() as con:
        rows = [dict(r) for r in con.execute("""SELECT c.id,c.field_id,f.name AS field_name,c.crop,c.symptom,
            c.possible_issue,c.guidance,c.notes,c.photo_type,c.created_at FROM crop_health_cases c
            LEFT JOIN farmer_fields f ON f.id=c.field_id AND f.farmer_id=c.farmer_id
            WHERE c.farmer_id=? ORDER BY c.id DESC LIMIT 50""", (g.farmer["id"],))]
    for row in rows: row["photo_url"] = f"/api/crop-health/{row['id']}/photo"
    return ok(rows)


@app.post("/api/crop-health")
def create_crop_health_case():
    crop = str(request.form.get("crop", "")).strip()
    symptom = str(request.form.get("symptom", "other")).strip()
    notes = str(request.form.get("notes", "")).strip()[:500]
    photo = request.files.get("photo")
    field_id = request.form.get("field_id") or None
    if META and crop not in META["categories"]["Crop"]: return fail("Choose a valid crop.", 422, {"crop": "Choose a valid crop."})
    if symptom not in DISEASE_GUIDANCE: return fail("Choose a symptom from the list.", 422, {"symptom": "Choose a symptom from the list."})
    if not photo: return fail("Add a clear crop photo first.", 422, {"photo": "Add a clear crop photo first."})
    data = photo.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024: return fail("Photo must be 4 MB or smaller.", 413)
    signatures = {"image/jpeg": data.startswith(b"\xff\xd8\xff"), "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
                  "image/webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP"}
    photo_type = photo.mimetype
    if photo_type not in signatures or not signatures[photo_type]:
        return fail("Use a valid JPG, PNG or WebP image.", 422)
    if field_id:
        try: field_id = int(field_id)
        except (TypeError, ValueError): return fail("Choose one of your saved fields.", 422)
        with db() as con:
            if not con.execute("SELECT 1 FROM farmer_fields WHERE id=? AND farmer_id=?", (field_id, g.farmer["id"])).fetchone():
                return fail("Choose one of your saved fields.", 422)
    issue, guidance = DISEASE_GUIDANCE[symptom]
    with db() as con:
        cur = con.execute("""INSERT INTO crop_health_cases(farmer_id,field_id,crop,symptom,possible_issue,guidance,notes,photo,photo_type,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)""", (g.farmer["id"], field_id, crop, symptom, issue, guidance, notes or None,
            sqlite3.Binary(data), photo_type, datetime.utcnow().isoformat(timespec="seconds")))
        case_id = cur.lastrowid
    return ok({"id": case_id, "crop": crop, "symptom": symptom, "possible_issue": issue, "guidance": guidance,
               "confidence": "not assessed by an image recognition model", "photo_url": f"/api/crop-health/{case_id}/photo"}, 201)


@app.get("/api/crop-health/<int:case_id>/photo")
def crop_health_photo(case_id):
    with db() as con:
        row = con.execute("SELECT photo,photo_type FROM crop_health_cases WHERE id=? AND farmer_id=?",
                          (case_id, g.farmer["id"])).fetchone()
    if not row: return fail("Photo not found.", 404)
    return Response(row["photo"], mimetype=row["photo_type"], headers={"Cache-Control": "private, no-store"})


@app.delete("/api/crop-health/<int:case_id>")
def delete_crop_health_case(case_id):
    with db() as con:
        n = con.execute("DELETE FROM crop_health_cases WHERE id=? AND farmer_id=?", (case_id, g.farmer["id"])).rowcount
    return ok({"deleted": case_id}) if n else fail("Crop health entry not found.", 404)


def validate(p):
    """Returns (clean_inputs, errors). Every field gets a human-readable message."""
    e, c = {}, {}
    for f in ("crop", "season", "state"):
        v = str(p.get(f, "")).strip()
        if v not in META["categories"][f.capitalize()]:
            e[f] = f"Choose a valid {f} from the list."
        c[f] = v
    def num(name, lo, hi, label, required=True):
        raw = p.get(name)
        if raw in (None, ""):
            if required: e[name] = f"{label} is required."
            return None
        try: x = float(raw)
        except (TypeError, ValueError):
            e[name] = f"{label} must be a number."; return None
        if not lo <= x <= hi:
            e[name] = f"{label} must be between {lo} and {hi}."; return None
        return x
    c["area"] = num("area", 0.01, 100000, "Farm area")
    c["rainfall"] = num("rainfall", 0, 12000, "Annual rainfall (mm)")
    c["fertilizer"] = num("fertilizer", 0, 5000, "Fertilizer (kg/ha)")
    c["pesticide"] = num("pesticide", 0, 500, "Pesticide (kg/ha)")
    c["soil_ph"] = num("soil_ph", 3, 10, "Soil pH", required=False)
    c["area_unit"] = p.get("area_unit", "hectare")
    if c["area_unit"] not in AREA_TO_HA: e["area_unit"] = "Area unit must be hectare or acre."
    return c, e


def predict_yield(c):
    row = pd.DataFrame([{"Crop": c["crop"], "Season": c["season"], "State": c["state"],
        "Crop_Year": META["latest_year"], "Area": c["area_ha"], "Annual_Rainfall": c["rainfall"],
        "Fertilizer_per_ha": c["fertilizer"], "Pesticide_per_ha": c["pesticide"]}])[CAT + NUM]
    return float(MODEL.predict(row)[0])


def risk_band(y, s):
    return "High" if y < s["yield_p25"] else "Moderate" if y < s["yield_p50"] else "Low"


@app.get("/api/health")
def health():
    if MODEL is None or META is None:
        return fail("Model is not ready. Check the deployment build logs.", 503)
    return ok({"status": "ok", "model_loaded": True})


@app.get("/api/options")
def options():
    if MODEL is None: return fail("Model not trained yet. Run train_model.py.", 503)
    return ok({"categories": META["categories"], "metrics": META["metrics"],
               "data_report": META["data_report"], "model": META["model"],
               "dataset": META["dataset_file"], "feature_importance": META["feature_importance"]})


@app.post("/api/soil-advice")
def soil_advice():
    """Adjust a locally recommended RDF using the soil lab's N/P/K categories."""
    payload = request.get_json(silent=True) or {}
    crop = str(payload.get("crop", "")).strip()
    if crop not in META["categories"]["Crop"]:
        return fail("Choose a crop from the list.", 422, {"crop": "Choose a valid crop."})
    state = str(payload.get("state", "")).strip()
    if state not in META["categories"]["State"]:
        return fail("Choose a state from the list.", 422, {"state": "Choose a valid state."})
    bands = {"Low": 1.25, "Medium": 1.0, "High": 0.75, "Very High": 0.0}
    nutrients = [("N", "Nitrogen (N)", "n"), ("P", "Phosphate (P₂O₅)", "p"), ("K", "Potash (K₂O)", "k")]
    recommendations, errors = [], {}
    for code, label, key in nutrients:
        status = str(payload.get(f"{key}_status", ""))
        try:
            rdf = float(payload.get(f"{key}_rdf", ""))
            if not 0 <= rdf <= 1000: raise ValueError
        except (TypeError, ValueError):
            errors[f"{key}_rdf"] = f"Enter a base {label} dose between 0 and 1000 kg/ha."
            continue
        if status not in bands:
            errors[f"{key}_status"] = f"Select the {label} category from your soil report."
            continue
        recommendations.append({"nutrient": code, "label": label, "status": status,
                                "base_rdf": rdf, "recommended": round(rdf * bands[status], 2),
                                "change_percent": round((bands[status] - 1) * 100)})
    micronutrients = []
    for key, label in [("s", "Sulphur (S)"), ("zn", "Zinc (Zn)"), ("fe", "Iron (Fe)"),
                       ("cu", "Copper (Cu)"), ("mn", "Manganese (Mn)"), ("b", "Boron (B)")]:
        status = str(payload.get(f"{key}_status", ""))
        if not status:
            continue
        if status not in bands:
            errors[f"{key}_status"] = f"Select the {label} category from your soil report."
        else:
            micronutrients.append({"label": label, "status": status})
    if errors: return fail("Check the soil report fields.", 422, errors)
    for item in recommendations:
        raw = payload.get(item["nutrient"].lower() + "_value")
        if raw not in (None, ""):
            try: item["test_value"] = float(raw)
            except (TypeError, ValueError):
                errors[item["nutrient"].lower() + "_value"] = "Enter a number from your soil report."
    if errors: return fail("Check the soil report fields.", 422, errors)
    return ok({"crop": crop, "state": state, "recommendations": recommendations,
               "micronutrients": micronutrients,
               "ph": payload.get("ph") or None, "organic_carbon": payload.get("organic_carbon") or None,
               "ec": payload.get("ec") or None,
               "basis": "Category-based adjustment of the local crop RDF; output is nutrient kg/ha, not fertilizer product kg/ha."})


def external_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "KisanSaathi/1.0"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504): raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last_error = exc
        if attempt < 2: time.sleep(.4 * (attempt + 1))
    raise last_error


@app.get("/api/geocode")
def geocode():
    query = request.args.get("q", "").strip()
    if len(query) < 2 or len(query) > 80:
        return fail("Enter a town or district name (2–80 characters).", 422)
    params = urllib.parse.urlencode({"name": query, "count": 8, "language": "en", "format": "json", "countryCode": "IN"})
    try:
        data = external_json("https://geocoding-api.open-meteo.com/v1/search?" + params)
        return ok([{"name": p.get("name"), "admin1": p.get("admin1", ""), "latitude": p["latitude"],
                    "longitude": p["longitude"]} for p in data.get("results", [])])
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        return fail(f"Could not search locations right now: {exc}", 502)


@app.get("/api/weather")
def weather():
    try:
        lat, lon = float(request.args["latitude"]), float(request.args["longitude"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180): raise ValueError
    except (KeyError, TypeError, ValueError):
        return fail("Valid latitude and longitude are required.", 422)
    params = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 7,
        "temperature_unit": "celsius", "wind_speed_unit": "kmh", "precipitation_unit": "mm",
        "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max"
    })
    cache_lat, cache_lon = round(lat, 3), round(lon, 3)
    cached = None
    with db() as con:
        cached = con.execute("SELECT payload,fetched_at FROM weather_cache WHERE lat=? AND lon=?",
                             (cache_lat, cache_lon)).fetchone()
    try:
        data = external_json("https://api.open-meteo.com/v1/forecast?" + params)
        fetched = datetime.now().isoformat(timespec="seconds")
        with db() as con:
            con.execute("""INSERT INTO weather_cache(lat,lon,payload,fetched_at) VALUES(?,?,?,?)
                ON CONFLICT(lat,lon) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at""",
                (cache_lat, cache_lon, json.dumps(data), fetched))
        data["_app"] = {"stale": False, "fetched_at": fetched}
        return ok(data)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        if cached:
            data = json.loads(cached["payload"])
            data["_app"] = {"stale": True, "fetched_at": cached["fetched_at"]}
            return ok(data)
        return fail(f"Weather provider is temporarily unavailable. Check your connection and retry. ({exc})", 502)


MARKET_COMMODITIES = {
    "Cotton": "Cotton", "Groundnut": "Groundnut", "Maize": "Maize", "Potato": "Potato",
    "Rice": "Paddy(Dhan)(Common)", "Soybean": "Soyabean", "Sugarcane": "Sugarcane", "Wheat": "Wheat"
}
MARKET_RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"


def market_api_page(api_key, commodity, state, offset=0):
    params = urllib.parse.urlencode({
        "api-key": api_key, "format": "json", "limit": 1000, "offset": offset,
        "filters[commodity]": commodity, "filters[state.keyword]": state
    })
    return external_json(f"https://api.data.gov.in/resource/{MARKET_RESOURCE}?{params}")


def market_api_state_page(api_key, state, offset=0):
    params = urllib.parse.urlencode({
        "api-key": api_key, "format": "json", "limit": 1000, "offset": offset,
        "filters[state.keyword]": state
    })
    return external_json(f"https://api.data.gov.in/resource/{MARKET_RESOURCE}?{params}")


@app.get("/api/market-crops")
def market_crops():
    state = request.args.get("state", "").strip()
    if META and state not in META["categories"]["State"]:
        return fail("Choose a state from the list.", 422)
    api_key = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if not api_key: return fail("Market crops are not configured yet. Add a valid data.gov.in API key.", 503)
    try:
        collected, offset, total = [], 0, None
        for _ in range(5):
            page = market_api_state_page(api_key, state, offset)
            if "records" not in page: raise ValueError("Unexpected response from the market data service.")
            rows = page.get("records", [])
            collected.extend(str(row.get("commodity", "")).strip() for row in rows)
            total = int(page.get("total", len(collected)))
            offset += len(rows)
            if not rows or offset >= total: break
        commodities = sorted({value for value in collected if value}, key=str.casefold)
        fetched = datetime.utcnow().isoformat(timespec="seconds")
        with db() as con:
            con.execute("""INSERT INTO market_commodity_cache(state,commodities,fetched_at) VALUES(?,?,?)
                ON CONFLICT(state) DO UPDATE SET commodities=excluded.commodities,fetched_at=excluded.fetched_at""",
                (state, json.dumps(commodities), fetched))
        return ok({"state": state, "commodities": commodities, "fetched_at": fetched, "stale": False})
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        with db() as con:
            cached = con.execute("SELECT commodities,fetched_at FROM market_commodity_cache WHERE state=?", (state,)).fetchone()
        if cached:
            return ok({"state": state, "commodities": json.loads(cached["commodities"]),
                       "fetched_at": cached["fetched_at"], "stale": True})
        reason = getattr(exc, "reason", None) or str(exc).strip() or "connection unavailable"
        return fail(f"Could not load the state's mandi crop list ({reason}).", 502)


@app.post("/api/market-key")
def save_market_key():
    """Validate and save a user's data.gov.in key locally; this endpoint is loopback-only."""
    if request.remote_addr not in ("127.0.0.1", "::1", "localhost"):
        return fail("Market-key setup is available only from this computer.", 403)
    api_key = str((request.get_json(silent=True) or {}).get("api_key", "")).strip()
    if not 20 <= len(api_key) <= 256 or any(ch.isspace() for ch in api_key):
        return fail("Paste the complete API key from your data.gov.in profile.", 422)
    try:
        probe = market_api_page(api_key, "Wheat", "Gujarat")
        if "records" not in probe and "total" not in probe:
            return fail("The API key was not accepted. Check the key and try again.", 422)
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        return fail(f"Could not validate the key with data.gov.in: {exc}", 502)
    env_path = os.path.join(HERE, ".env")
    try:
        set_key(env_path, "DATA_GOV_API_KEY", api_key, quote_mode="always")
        os.chmod(env_path, 0o600)
        os.environ["DATA_GOV_API_KEY"] = api_key
    except OSError as exc:
        return fail(f"Could not save the key locally: {exc}", 500)
    return ok({"configured": True, "message": "Market API connected. Your key was saved locally."})


@app.get("/api/market-prices")
def market_prices():
    crop, state = request.args.get("crop", "").strip(), request.args.get("state", "").strip()
    district = request.args.get("district", "").strip()
    if not 2 <= len(crop) <= 100:
        return fail("Choose a crop from the market list.", 422)
    if META and state not in META["categories"]["State"]:
        return fail("Choose a state from the list.", 422)
    api_key = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if not api_key:
        return fail("Mandi prices need a free data.gov.in API key. Add DATA_GOV_API_KEY to backend/.env and restart the app.", 503,
                    {"setup_url": "https://www.data.gov.in/help"})
    try:
        collected, offset, total = [], 0, None
        for _ in range(5):
            page = market_api_page(api_key, MARKET_COMMODITIES.get(crop, crop), state, offset)
            if "records" not in page:
                raise ValueError(page.get("message", "The market data service returned an unexpected response."))
            rows = page.get("records", [])
            collected.extend(rows)
            total = int(page.get("total", len(collected)))
            offset += len(rows)
            if not rows or offset >= total: break
        normalized = []
        for row in collected:
            try:
                reported_date = str(row.get("arrival_date", "")).strip()
                try: price_date = datetime.strptime(reported_date, "%d/%m/%Y").date().isoformat()
                except ValueError: price_date = datetime.fromisoformat(reported_date[:10]).date().isoformat()
                item = {"crop": crop, "state": str(row.get("state", state)).strip(),
                        "district": str(row.get("district", "")).strip(),
                        "market": str(row.get("market", "")).strip(),
                        "variety": str(row.get("variety", "")).strip(), "grade": str(row.get("grade", "")).strip(),
                        "arrival_date": price_date,
                        "min_price": float(str(row.get("min_price") or 0).replace(",", "")),
                        "max_price": float(str(row.get("max_price") or 0).replace(",", "")),
                        "modal_price": float(str(row.get("modal_price") or 0).replace(",", ""))}
                if not item["market"] or item["modal_price"] <= 0: continue
                if district and district.casefold() not in item["district"].casefold(): continue
                normalized.append(item)
            except (TypeError, ValueError):
                continue
        now = datetime.now().isoformat(timespec="seconds")
        with db() as con:
            con.executemany("""INSERT INTO market_price_history
                (crop,state,district,market,variety,grade,price_date,min_price,max_price,modal_price,captured_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(crop,state,district,market,variety,grade,price_date)
                DO UPDATE SET min_price=excluded.min_price,max_price=excluded.max_price,
                modal_price=excluded.modal_price,captured_at=excluded.captured_at""",
                [(crop, r["state"], r["district"], r["market"], r["variety"], r["grade"], r["arrival_date"],
                  r["min_price"], r["max_price"], r["modal_price"], now) for r in normalized])
        normalized.sort(key=lambda x: (x["arrival_date"], x["modal_price"]), reverse=True)
        latest_date = max((r["arrival_date"] for r in normalized), default=None)
        return ok({"crop": crop, "state": state, "district": district or None,
                   "records": normalized[:1000], "total_records": len(normalized), "latest_date": latest_date,
                   "source": "AGMARKNET via data.gov.in", "unit": "₹/quintal"})
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        where, args = "crop=? AND state=?", [crop, state]
        if district:
            where += " AND lower(district) LIKE ?"; args.append("%" + district.casefold() + "%")
        with db() as con:
            saved = [dict(row) for row in con.execute(f"""SELECT crop,state,district,market,variety,grade,
                price_date AS arrival_date,min_price,max_price,modal_price,captured_at
                FROM market_price_history WHERE {where} ORDER BY price_date DESC,captured_at DESC LIMIT 1000""", args)]
        if saved:
            latest_date = max(row["arrival_date"] for row in saved)
            return ok({"crop": crop, "state": state, "district": district or None,
                       "records": saved, "total_records": len(saved), "latest_date": latest_date,
                       "source": "Previously saved AGMARKNET reports", "unit": "₹/quintal",
                       "stale": True, "cache_fetched_at": max(row["captured_at"] for row in saved)})
        reason = getattr(exc, "reason", None) or str(exc).strip() or "connection unavailable"
        return fail(f"Live mandi prices are temporarily unavailable ({reason}); no saved report exists for this selection yet.", 502)


@app.get("/api/market-history")
def market_history():
    crop, state = request.args.get("crop", "").strip(), request.args.get("state", "").strip()
    market = request.args.get("market", "").strip()
    district = request.args.get("district", "").strip()
    variety, grade = request.args.get("variety", "").strip(), request.args.get("grade", "").strip()
    if not 2 <= len(crop) <= 100 or (META and state not in META["categories"]["State"]):
        return fail("Choose a valid crop and state.", 422)
    query = "SELECT price_date, AVG(min_price) AS min_price, AVG(max_price) AS max_price, AVG(modal_price) AS modal_price FROM market_price_history WHERE crop=? AND state=?"
    args = [crop, state]
    if market:
        query += " AND market=?"; args.append(market)
    if district:
        query += " AND district=?"; args.append(district)
    if variety:
        query += " AND variety=?"; args.append(variety)
    if grade:
        query += " AND grade=?"; args.append(grade)
    query += " GROUP BY price_date ORDER BY price_date DESC LIMIT 90"
    with db() as con:
        rows = [dict(r) for r in con.execute(query, args)]
    rows.reverse()
    return ok({"crop": crop, "state": state, "market": market or None, "prices": rows,
               "history_note": "History is collected from price reports opened in this app; no missing day is estimated."})


@app.post("/api/predict")
def predict():
    if MODEL is None: return fail("Model not trained yet. Run train_model.py.", 503)
    c, err = validate(request.get_json(silent=True) or {})
    if err: return fail("Please correct the highlighted fields.", 422, err)
    c["area_ha"] = c["area"] * AREA_TO_HA[c["area_unit"]]
    y = predict_yield(c)
    stats = META["crop_stats"].get(c["crop"])
    risk = risk_band(y, stats)
    prod = y * c["area_ha"]
    with db() as con:
        cur = con.execute("INSERT INTO predictions(farmer_id,created_at,crop,season,state,area_ha,yield_t_ha,"
            "production_t,risk,inputs) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (g.farmer["id"], datetime.now().isoformat(timespec="seconds"), c["crop"], c["season"], c["state"],
             c["area_ha"], y, prod, risk, json.dumps(c)))
    imp = sorted(META["feature_importance"].items(), key=lambda kv: -kv[1])[:5]
    return ok({"id": cur.lastrowid, "predicted_yield": round(y, 3), "yield_unit": "tonnes/ha",
        "area_ha": round(c["area_ha"], 3), "estimated_production": round(prod, 2),
        "production_unit": "tonnes", "risk": risk,
        "risk_explanation": "Risk compares the prediction with historical yields of this crop in the "
            "training data: below 25th percentile = High, 25th-50th = Moderate, above = Low.",
        "top_factors": [{"feature": k, "importance": round(v, 4)} for k, v in imp],
        "top_factors_note": "Global model importance, not specific to this single prediction.",
        "reference_yield_median": round(stats["yield_p50"], 3),
        "recommendations": recommendations.build(c, stats, risk)}, 201)


@app.post("/api/recommend-crops")
def recommend_crops():
    """Model-based ranking: predict every crop for the given conditions, rank by
    predicted yield relative to that crop's historical median."""
    if MODEL is None: return fail("Model not trained yet.", 503)
    c, err = validate({**(request.get_json(silent=True) or {}), "crop": META["categories"]["Crop"][0]})
    err.pop("crop", None)
    if err: return fail("Please correct the highlighted fields.", 422, err)
    c["area_ha"] = c["area"] * AREA_TO_HA[c["area_unit"]]
    out = []
    for crop, s in META["crop_stats"].items():
        if s["n"] < 30: continue  # too little data for a trustworthy ranking
        y = predict_yield({**c, "crop": crop})
        out.append({"crop": crop, "predicted_yield": round(y, 3),
                    "vs_median": round(y / s["yield_p50"], 2) if s["yield_p50"] else None})
    out.sort(key=lambda r: -(r["vs_median"] or 0))
    return ok({"ranking": out[:10], "method": "model-based (Random Forest), ranked by predicted/median yield"})


@app.get("/api/history")
def history():
    with db() as con:
        rows = [dict(r) for r in con.execute("SELECT id,created_at,crop,season,state,area_ha,"
                "yield_t_ha,production_t,risk FROM predictions WHERE farmer_id=? ORDER BY id DESC", (g.farmer["id"],))]
    return ok(rows)


@app.delete("/api/history/<int:rid>")
def delete_history(rid):
    with db() as con:
        n = con.execute("DELETE FROM predictions WHERE id=? AND farmer_id=?", (rid, g.farmer["id"])).rowcount
    return ok({"deleted": rid}) if n else fail("Record not found.", 404)


@app.get("/api/history/export")
def export_history():
    with db() as con:
        rows = con.execute("SELECT id,created_at,crop,season,state,area_ha,yield_t_ha,"
                           "production_t,risk FROM predictions WHERE farmer_id=? ORDER BY id", (g.farmer["id"],)).fetchall()
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["id", "date", "crop", "season", "state", "area_ha", "yield_t_ha", "production_t", "risk"])
    w.writerows([tuple(r) for r in rows])
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=prediction_report.csv"})


@app.get("/api/analytics")
def analytics():
    if MODEL is None: return fail("Model not trained yet.", 503)
    with db() as con:
        risk = [dict(r) for r in con.execute("SELECT risk, COUNT(*) AS count FROM predictions WHERE farmer_id=? GROUP BY risk", (g.farmer["id"],))]
    return ok({**META["analytics"], "risk_distribution": risk,
               "source": f"Training dataset ({META['dataset_file']}); risk chart from saved predictions"})


@app.get("/")
def index():
    return send_from_directory(FRONT, "index.html")


@app.get("/<path:name>")
def site_files(name):
    if name.startswith("api/"): return fail("Not found.", 404)
    return send_from_directory(FRONT, name)


if __name__ == "__main__":
    app.run(port=int(os.environ.get("FLASK_PORT", 5001)), debug=False)
