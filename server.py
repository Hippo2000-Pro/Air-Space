"""Air Space web app: local MVP server, SQLite storage, individual role-based accounts."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import unicodedata
import webbrowser
from email.parser import BytesParser
from email.policy import default as email_policy
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("AIR_SPACE_DB", str(ROOT / "air_space.sqlite3"))).expanduser().resolve()
VIDEO_UPLOAD_DIR = DB_PATH.parent / "uploads" / "videos"
HOST = os.environ.get("AIR_SPACE_HOST", "127.0.0.1")
PORT = int(os.environ.get("AIR_SPACE_PORT", os.environ.get("PORT", "0")))
COOKIE_SECURE = os.environ.get("AIR_SPACE_HTTPS", "1" if os.environ.get("RENDER") else "0") == "1"
OPEN_BROWSER = os.environ.get("AIR_SPACE_OPEN_BROWSER", "1") == "1"
ALLOW_SETUP = os.environ.get("AIR_SPACE_ALLOW_SETUP", "1") == "1"
SESSION_SECONDS = 8 * 60 * 60
HASH_ROUNDS = 260_000
STATUSES = {"new", "contacted", "confirmed", "declined"}
ROLES = {"owner", "manager", "bookings", "catalog", "viewer"}
EXPENSE_CATEGORIES = {
    "materials": "Matériel",
    "printing": "Impression 3D",
    "safety": "Sécurité",
    "transport": "Transport",
    "communication": "Communication",
    "event": "Organisation des spectacles",
    "other": "Autre",
}
EXPENSE_STATUSES = {"paid", "planned"}
PERMISSIONS = {
    "owner": {"bookings:read", "bookings:write", "offers:read", "offers:write", "settings:read", "settings:write", "team:read", "team:write", "budget:read", "budget:write", "shop:read", "shop:write", "events:read", "events:write"},
    "manager": {"bookings:read", "bookings:write", "offers:read", "offers:write", "settings:read", "settings:write", "shop:read", "shop:write", "events:read", "events:write"},
    "bookings": {"bookings:read", "bookings:write"},
    "catalog": {"offers:read", "offers:write", "settings:read", "settings:write", "shop:read", "shop:write", "events:read", "events:write"},
    "viewer": {"bookings:read", "offers:read", "settings:read"},
}
ROLE_LABELS = {"owner": "Directeur / propriétaire", "manager": "Responsable", "bookings": "Réservations", "catalog": "Tarifs et contenu", "viewer": "Lecture seule"}
STATIC_EXTENSIONS = {".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".webmanifest"}
SESSIONS: dict[str, tuple[int, float]] = {}
LOGIN_FAILURES: dict[str, tuple[int, float]] = {}
PUBLIC_REQUESTS: dict[str, list[float]] = {}


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price_cents INTEGER,
          duration_minutes INTEGER,
          active INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          customization_allowed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reservations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          event_date TEXT NOT NULL,
          city TEXT NOT NULL,
          age INTEGER,
          guests INTEGER,
          details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'new',
          created_at TEXT NOT NULL,
          offer_id INTEGER,
          offer_name TEXT NOT NULL DEFAULT '',
          offer_price_cents INTEGER,
          rocket_color TEXT NOT NULL DEFAULT '#3978b8',
          rocket_body_color TEXT NOT NULL DEFAULT '#b86b2c',
          rocket_theme TEXT NOT NULL DEFAULT 'etoiles',
          rocket_name TEXT NOT NULL DEFAULT '',
          rocket_message TEXT NOT NULL DEFAULT '',
          event_time TEXT NOT NULL DEFAULT '',
          preferred_setup_time TEXT NOT NULL DEFAULT '',
          requested_setup_finish_time TEXT NOT NULL DEFAULT '',
          requested_finish_time TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spent_on TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
          status TEXT NOT NULL DEFAULT 'paid',
          details TEXT NOT NULL DEFAULT '',
          created_by INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses(spent_on DESC, id DESC);
        CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL DEFAULT 0, image_url TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS public_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL, event_time TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', venue TEXT NOT NULL DEFAULT '', public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS launch_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shop_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT NOT NULL, customer_name TEXT NOT NULL, email TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS eco_records (id INTEGER PRIMARY KEY AUTOINCREMENT, material TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'kg', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, idea TEXT NOT NULL UNIQUE, votes INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS vote_receipts (client_id TEXT NOT NULL, vote_id INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(client_id,vote_id));
        CREATE TABLE IF NOT EXISTS community_ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL, idea TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS air_challenges (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, reward_points INTEGER NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS point_wallets (client_id TEXT PRIMARY KEY, points INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS challenge_completions (client_id TEXT NOT NULL, challenge_id INTEGER NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(client_id,challenge_id));
        CREATE TABLE IF NOT EXISTS bot_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, keywords TEXT NOT NULL, answer TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS public_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, page_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    """)
    # Upgrade databases created by the earlier Air Space prototype.
    columns = {row[1] for row in db.execute("PRAGMA table_info(reservations)")}
    offer_columns = {row[1] for row in db.execute("PRAGMA table_info(offers)")}
    if "customization_allowed" not in offer_columns:
        db.execute("ALTER TABLE offers ADD COLUMN customization_allowed INTEGER NOT NULL DEFAULT 0")
    for column, definition in {
        "offer_id": "INTEGER",
        "offer_name": "TEXT NOT NULL DEFAULT ''",
        "offer_price_cents": "INTEGER",
        "rocket_color": "TEXT NOT NULL DEFAULT '#3978b8'",
        "rocket_body_color": "TEXT NOT NULL DEFAULT '#b86b2c'",
        "rocket_theme": "TEXT NOT NULL DEFAULT 'etoiles'",
        "rocket_name": "TEXT NOT NULL DEFAULT ''",
        "rocket_message": "TEXT NOT NULL DEFAULT ''",
        "event_time": "TEXT NOT NULL DEFAULT ''",
        "preferred_setup_time": "TEXT NOT NULL DEFAULT ''",
        "requested_setup_finish_time": "TEXT NOT NULL DEFAULT ''",
        "requested_finish_time": "TEXT NOT NULL DEFAULT ''",
    }.items():
        if column not in columns:
            db.execute(f"ALTER TABLE reservations ADD COLUMN {column} {definition}")
    defaults = {
        "company_name": "Air Space",
        "tagline": "Un anniversaire prêt au décollage.",
        "service_area": "Le Rhône, autour de Lyon",
        "public_email": "Air-Space_08@hotmail.com",
        "public_phone": "",
        "donation_account_name": "",
        "donation_iban": "",
        "booking_enabled": "1",
        "currency": "EUR",
        "budget_limit_cents": "500000",
        "price_note": "Choisissez une formule ou faites une demande personnalisée.",
        "hero_description": "Des fusées miniatures à air et à eau, un compte à rebours partagé, et un grand moment à vivre ensemble dans le Rhône, autour de Lyon.",
        "concept_description": "Air Space imagine des spectacles de petites fusées à air et à eau, conçues avec des bouteilles réutilisées et des éléments décoratifs imprimés en 3D.",
        "concept_followup": "Le spectacle se prépare avec vous pour s’adapter à l’anniversaire, au lieu et aux invités.",
        "customizer_description": "Choisissez une couleur, un thème et un nom pour imaginer la fusée de l’anniversaire. L’équipe confirmera les possibilités avec vous.",
        "booking_description": "Racontez-nous votre idée. Air Space vous recontactera pour vérifier la date et préparer le spectacle.",
        "booking_disclaimer": "Votre demande sera enregistrée dans l’espace de gestion Air Space. Aucun paiement n’est demandé ici.",
        "step_one_note": "Indiquez la date souhaitée, la ville et l’idée de votre anniversaire.",
        "step_two_note": "L’équipe reprend contact pour parler du lieu, de la formule et des détails.",
        "step_three_note": "Les choix de décoration sont étudiés avec vous. La demande ne vaut pas confirmation.",
        "safety_title": "Un projet porté par des jeunes et accompagné par des adultes.",
        "safety_description": "Les démonstrations se feront avec la présence et l’accompagnement d’adultes responsables, sur un lieu adapté et selon des consignes de sécurité préparées avec eux.",
        "contact_description": "Écrivez-nous pour parler de votre anniversaire, des disponibilités ou du projet Air Space.",
        "donation_description": "Votre soutien nous aidera à préparer les fusées et les spectacles pour les anniversaires.",
        "airbot_fallback": "Je n’ai pas encore cette réponse dans ma base. Consultez les rubriques du site ou écrivez à Air-Space_08@hotmail.com.",
    }
    for key, value in defaults.items():
        db.execute("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)", (key, value))
    db.execute("UPDATE settings SET value=? WHERE key='public_email' AND value IN ('', 'Air-Space08@hotmail.com')", ("Air-Space_08@hotmail.com",))
    db.execute("UPDATE settings SET value=? WHERE key='price_note' AND value=''", ("Choisissez une formule ou faites une demande personnalisée.",))
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ROUNDS)
    return f"pbkdf2_sha256${HASH_ROUNDS}${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)).hex()
        return hmac.compare_digest(check, digest_hex)
    except (ValueError, TypeError):
        return False


def clean_text(value: object, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        if required:
            raise ValueError("Vérifiez les champs obligatoires.")
        return ""
    value = value.strip()
    if len(value) > limit:
        raise ValueError(f"Un champ dépasse la longueur autorisée ({limit} caractères).")
    if required and not value:
        raise ValueError("Merci de remplir tous les champs obligatoires.")
    return value


def valid_iban(value: str) -> bool:
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", value):
        return False
    rearranged = value[4:] + value[:4]
    remainder = 0
    for character in rearranged:
        digits = character if character.isdigit() else str(ord(character) - 55)
        for digit in digits:
            remainder = (remainder * 10 + int(digit)) % 97
    return remainder == 1


def optional_integer(value: object, low: int, high: int, field: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"La valeur du champ « {field} » est invalide.") from exc
    if number < low or number > high:
        raise ValueError(f"Le champ « {field} » doit être compris entre {low} et {high}.")
    return number


def settings_dict(db: sqlite3.Connection) -> dict[str, str]:
    return {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM settings")}


def offer_dict(row: sqlite3.Row) -> dict:
    return {**dict(row), "active": bool(row["active"]), "customization_allowed": bool(row["customization_allowed"]), "price_euros": None if row["price_cents"] is None else row["price_cents"] / 100}


def expense_values(payload: dict) -> dict:
    try:
        spent_on = date.fromisoformat(clean_text(payload.get("spent_on"), 10, required=True))
    except ValueError as exc:
        raise ValueError("Choisissez une date valide pour la dépense.") from exc
    description = clean_text(payload.get("description"), 180, required=True)
    category = clean_text(payload.get("category"), 24, required=True)
    if category not in EXPENSE_CATEGORIES:
        raise ValueError("Choisissez une catégorie de dépense valide.")
    amount_cents = payload.get("amount_cents")
    if isinstance(amount_cents, bool) or not isinstance(amount_cents, int) or not 1 <= amount_cents <= 100_000_000:
        raise ValueError("Le montant doit être supérieur à 0 € et inférieur à 1 000 000 €.")
    status = payload.get("status", "paid")
    if not isinstance(status, str) or status not in EXPENSE_STATUSES:
        raise ValueError("Choisissez « Payée » ou « Prévue ».")
    details = clean_text(payload.get("details"), 500)
    return {"spent_on": spent_on.isoformat(), "description": description, "category": category, "amount_cents": amount_cents, "status": status, "details": details}


class AirSpaceHandler(BaseHTTPRequestHandler):
    server_version = "AirSpaceApp"
    sys_version = ""

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
        if COOKIE_SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.client_address[0]} - {fmt % args}")

    def send_json(self, payload: dict, status: int = 200, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Requête invalide.") from exc
        if length <= 0 or length > 16_384:
            raise ValueError("La requête est vide ou trop volumineuse.")
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("Format de requête invalide.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("Les informations reçues sont invalides.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Les informations reçues sont invalides.")
        return payload

    def session_user(self) -> dict | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get("air_space_session")
        token = morsel.value if morsel else None
        session = SESSIONS.get(token or "")
        if not session or session[1] < time.time():
            if token:
                SESSIONS.pop(token, None)
            return None
        with database() as db:
            row = db.execute("SELECT id,name,email,role,active,must_change_password FROM users WHERE id=?", (session[0],)).fetchone()
        if not row or not row["active"]:
            SESSIONS.pop(token, None)
            return None
        return dict(row)

    def permission(self, required: str) -> dict | None:
        user = self.session_user()
        if not user:
            self.send_json({"error": "Connexion requise."}, 401)
            return None
        if user["must_change_password"]:
            self.send_json({"error": "Vous devez choisir votre mot de passe personnel avant de continuer."}, 403)
            return None
        if required not in PERMISSIONS.get(user["role"], set()):
            self.send_json({"error": "Votre compte n’a pas accès à cette fonction."}, 403)
            return None
        return user

    def audit(self, user_id: int | None, action: str, target_type: str, target_id: str = "") -> None:
        with database() as db:
            db.execute("INSERT INTO audit_log(user_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?)", (user_id, action, target_type, target_id, now_iso()))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        media_match = re.fullmatch(r"/media/videos/([a-f0-9]{32}\.(?:mp4|webm))", path)
        if media_match:
            self.serve_video(media_match.group(1))
            return
        if path == "/api/public":
            with database() as db:
                settings = settings_dict(db)
                offers = db.execute("SELECT * FROM offers WHERE active=1 ORDER BY sort_order,id").fetchall()
            public_keys = ("company_name", "tagline", "service_area", "public_email", "public_phone", "booking_enabled", "price_note", "donation_account_name", "donation_iban", "hero_description", "concept_description", "concept_followup", "customizer_description", "booking_description", "booking_disclaimer", "step_one_note", "step_two_note", "step_three_note", "safety_title", "safety_description", "contact_description", "donation_description", "airbot_fallback")
            public_settings = {key: settings.get(key, "") for key in public_keys}
            self.send_json({"settings": public_settings, "offers": [offer_dict(row) for row in offers]})
            return
        if path == "/api/public/events":
            with database() as db:
                rows = db.execute("SELECT id,title,description,event_date,event_time,city,venue FROM public_events WHERE public=1 AND event_date>=date('now') ORDER BY event_date,event_time").fetchall()
            self.send_json({"events": [dict(row) for row in rows]})
            return
        if path == "/api/public/videos":
            with database() as db:
                rows = db.execute("SELECT id,title,description,video_url FROM launch_videos WHERE active=1 ORDER BY id DESC").fetchall()
            self.send_json({"videos": [dict(row) for row in rows]})
            return
        if path == "/api/public/shop":
            with database() as db:
                rows = db.execute("SELECT id,name,description,price_cents,image_url FROM products WHERE active=1 ORDER BY id DESC").fetchall()
            self.send_json({"products": [dict(row) for row in rows]})
            return
        if path == "/api/public/air-lab":
            with database() as db:
                votes=db.execute("SELECT id,idea,votes FROM votes WHERE active=1 ORDER BY votes DESC,id").fetchall()
                eco=db.execute("SELECT material,ROUND(SUM(quantity),2) quantity,unit FROM eco_records GROUP BY material,unit ORDER BY material").fetchall()
                ideas=db.execute("SELECT nickname,idea,created_at FROM community_ideas WHERE status='approved' ORDER BY id DESC LIMIT 20").fetchall()
                challenges=db.execute("SELECT id,title,question,reward_points FROM air_challenges WHERE active=1 ORDER BY id DESC").fetchall()
                faqs=db.execute("SELECT id,keywords,answer FROM bot_answers WHERE active=1 ORDER BY id").fetchall()
            self.send_json({"votes":[dict(x) for x in votes],"eco":[dict(x) for x in eco],"ideas":[dict(x) for x in ideas],"challenges":[dict(x) for x in challenges],"faqs":[dict(x) for x in faqs]})
            return
        if path == "/api/public/updates":
            with database() as db: rows=db.execute("SELECT id,title,body,created_at FROM news WHERE published=1 ORDER BY id DESC LIMIT 20").fetchall()
            self.send_json({"news":[dict(x) for x in rows]}); return
        if path == "/api/public/partners":
            with database() as db: rows=db.execute("SELECT id,name,description,url FROM partners WHERE published=1 ORDER BY id").fetchall()
            self.send_json({"partners":[dict(x) for x in rows]}); return
        if path == "/api/public/pages":
            with database() as db: rows=db.execute("SELECT page_key,title,body,created_at FROM public_pages WHERE published=1 ORDER BY page_key,title").fetchall()
            self.send_json({"pages":[dict(x) for x in rows]}); return
        match = re.fullmatch(r"/api/public/air-points/([0-9a-fA-F-]{36})", path)
        if match:
            with database() as db:
                points=db.execute("SELECT points FROM point_wallets WHERE client_id=?",(match.group(1),)).fetchone()
                done=db.execute("SELECT challenge_id FROM challenge_completions WHERE client_id=?",(match.group(1),)).fetchall()
            self.send_json({"points":points[0] if points else 0,"completed":[x[0] for x in done]}); return
        if path == "/api/admin/content":
            if not self.permission("shop:read"):
                return
            with database() as db:
                products = db.execute("SELECT * FROM products ORDER BY id DESC").fetchall()
                events = db.execute("SELECT * FROM public_events ORDER BY event_date,event_time").fetchall()
                videos = db.execute("SELECT * FROM launch_videos ORDER BY id DESC").fetchall()
                orders = db.execute("SELECT * FROM shop_orders ORDER BY id DESC").fetchall()
                ideas = db.execute("SELECT * FROM community_ideas ORDER BY id DESC").fetchall()
                votes = db.execute("SELECT * FROM votes ORDER BY id DESC").fetchall()
                eco = db.execute("SELECT * FROM eco_records ORDER BY id DESC").fetchall()
                news = db.execute("SELECT * FROM news ORDER BY id DESC").fetchall()
                partners = db.execute("SELECT * FROM partners ORDER BY id DESC").fetchall()
                challenges = db.execute("SELECT * FROM air_challenges ORDER BY id DESC").fetchall()
                bot_answers = db.execute("SELECT * FROM bot_answers ORDER BY id DESC").fetchall()
                pages = db.execute("SELECT * FROM public_pages ORDER BY page_key,title").fetchall()
                point_wallets = db.execute("SELECT count(*) AS players,coalesce(sum(points),0) AS points FROM point_wallets").fetchone()
            self.send_json({"products":[dict(x) for x in products],"events":[dict(x) for x in events],"videos":[dict(x) for x in videos],"orders":[dict(x) for x in orders],"ideas":[dict(x) for x in ideas],"votes":[dict(x) for x in votes],"eco":[dict(x) for x in eco],"news":[dict(x) for x in news],"partners":[dict(x) for x in partners],"challenges":[dict(x) for x in challenges],"bot_answers":[dict(x) for x in bot_answers],"pages":[dict(x) for x in pages],"points_summary":dict(point_wallets)})
            return
        if path == "/api/admin/setup-status":
            with database() as db:
                has_owner = db.execute("SELECT 1 FROM users WHERE role='owner' AND active=1 LIMIT 1").fetchone() is not None
            setup_key_required = bool(os.environ.get("AIR_SPACE_SETUP_KEY"))
            setup_allowed = ALLOW_SETUP and (setup_key_required or not os.environ.get("RENDER"))
            self.send_json({"setup_required": not has_owner, "setup_allowed": setup_allowed, "setup_key_required": setup_key_required})
            return
        if path == "/api/admin/me":
            user = self.session_user()
            if not user:
                self.send_json({"error": "Connexion requise."}, 401)
                return
            self.send_json({"user": user, "permissions": sorted(PERMISSIONS[user["role"]]), "role_label": ROLE_LABELS[user["role"]]})
            return
        if path == "/api/admin/overview":
            user = self.permission("bookings:read")
            if not user:
                return
            with database() as db:
                total = db.execute("SELECT COUNT(*) n FROM reservations").fetchone()["n"]
                new_count = db.execute("SELECT COUNT(*) n FROM reservations WHERE status='new'").fetchone()["n"]
                confirmed = db.execute("SELECT COUNT(*) n FROM reservations WHERE status='confirmed'").fetchone()["n"]
                recent = db.execute("SELECT * FROM reservations ORDER BY created_at DESC LIMIT 5").fetchall()
                new_orders = db.execute("SELECT COUNT(*) n FROM shop_orders WHERE status='new'").fetchone()["n"]
                upcoming_events = db.execute("SELECT COUNT(*) n FROM public_events WHERE public=1 AND event_date>=date('now')").fetchone()["n"]
                pending_ideas = db.execute("SELECT COUNT(*) n FROM community_ideas WHERE status='pending'").fetchone()["n"]
                live_products = db.execute("SELECT COUNT(*) n FROM products WHERE active=1").fetchone()["n"]
            self.send_json({"total": total, "new": new_count, "confirmed": confirmed, "recent": [dict(row) for row in recent], "new_orders":new_orders,"upcoming_events":upcoming_events,"pending_ideas":pending_ideas,"live_products":live_products})
            return
        if path == "/api/admin/budget":
            if not self.permission("budget:read"):
                return
            with database() as db:
                settings = settings_dict(db)
                rows = db.execute("SELECT e.*,u.name AS author_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by ORDER BY e.spent_on DESC,e.id DESC").fetchall()
                totals = db.execute("SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS spent_cents, COALESCE(SUM(CASE WHEN status='planned' THEN amount_cents ELSE 0 END),0) AS planned_cents FROM expenses").fetchone()
                by_category = db.execute("SELECT category,COALESCE(SUM(amount_cents),0) AS amount_cents FROM expenses GROUP BY category ORDER BY amount_cents DESC").fetchall()
            budget_limit = int(settings.get("budget_limit_cents", "500000"))
            spent = int(totals["spent_cents"])
            planned = int(totals["planned_cents"])
            self.send_json({"budget_limit_cents": budget_limit, "spent_cents": spent, "planned_cents": planned, "remaining_cents": budget_limit-spent-planned, "expenses": [dict(row) for row in rows], "by_category": [dict(row) for row in by_category], "categories": EXPENSE_CATEGORIES})
            return
        if path == "/api/admin/reservations":
            if not self.permission("bookings:read"):
                return
            with database() as db:
                rows = db.execute("SELECT * FROM reservations ORDER BY created_at DESC,id DESC").fetchall()
            self.send_json({"reservations": [dict(row) for row in rows]})
            return
        if path == "/api/admin/offers":
            if not self.permission("offers:read"):
                return
            with database() as db:
                rows = db.execute("SELECT * FROM offers ORDER BY sort_order,id").fetchall()
            self.send_json({"offers": [offer_dict(row) for row in rows]})
            return
        if path == "/api/admin/settings":
            if not self.permission("settings:read"):
                return
            with database() as db:
                self.send_json({"settings": settings_dict(db)})
            return
        if path == "/api/admin/users":
            if not self.permission("team:read"):
                return
            with database() as db:
                rows = db.execute("SELECT id,name,email,role,active,created_at FROM users ORDER BY id").fetchall()
            self.send_json({"users": [dict(row) for row in rows], "role_labels": ROLE_LABELS})
            return
        if path == "/admin":
            path = "/admin.html"
        if path == "/boutique":
            path = "/boutique.html"
        if path in {"/agenda", "/creations", "/spectacles", "/air-ar", "/air-lab", "/airbot", "/air-vote", "/ecotracker", "/air-points", "/reservation", "/contact"}:
            path = "/app-page.html"
        self.serve_static(path)

    def serve_static(self, path: str) -> None:
        decoded = unquote(path)
        if decoded == "/":
            decoded = "/index.html"
        target = (ROOT / decoded.lstrip("/")).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return
        if target.suffix.lower() not in STATIC_EXTENSIONS or not target.is_file():
            self.send_error(404)
            return
        body = target.read_bytes()
        content_type = "application/manifest+json" if target.suffix.lower() == ".webmanifest" else mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type in {"application/javascript", "image/svg+xml"} else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def serve_video(self, filename: str) -> None:
        target = (VIDEO_UPLOAD_DIR / filename).resolve()
        try:
            target.relative_to(VIDEO_UPLOAD_DIR.resolve())
            size = target.stat().st_size
        except (ValueError, OSError):
            self.send_error(404)
            return
        start, end, status = 0, size - 1, 200
        range_header = self.headers.get("Range", "")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match or size == 0:
                self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            left, right = match.groups()
            if left:
                start = int(left); end = min(int(right), size - 1) if right else size - 1
            else:
                suffix = int(right or 0); start = max(0, size - suffix)
            if start >= size or end < start:
                self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
            status = 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", "video/mp4" if filename.endswith(".mp4") else "video/webm")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        with target.open("rb") as stream:
            stream.seek(start); remaining = length
            while remaining:
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining -= len(chunk)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/reservations":
            self.create_reservation()
        elif path == "/api/public/shop/orders":
            self.create_shop_order()
        elif path == "/api/public/vote":
            self.cast_vote()
        elif path == "/api/public/air-points":
            self.complete_challenge()
        elif path == "/api/public/community/ideas":
            self.submit_community_idea()
        elif path == "/api/public/airbot":
            self.airbot_answer()
        elif path == "/api/admin/content":
            self.save_content_item()
        elif path == "/api/admin/videos/upload":
            self.upload_video()
        elif path == "/api/admin/login":
            self.admin_login()
        elif path == "/api/admin/setup":
            self.setup_owner()
        elif path == "/api/admin/logout":
            token = self.session_token()
            if token:
                SESSIONS.pop(token, None)
            self.send_json({"ok": True}, headers={"Set-Cookie": self.session_cookie("", max_age=0)})
        elif path == "/api/admin/users":
            self.create_user()
        elif path == "/api/admin/offers":
            self.save_offer()
        elif path == "/api/admin/expenses":
            self.save_expense()
        elif path == "/api/admin/change-password":
            self.change_password()
        else:
            self.send_json({"error": "Page introuvable."}, 404)

    def session_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get("air_space_session")
        return morsel.value if morsel else None

    def session_cookie(self, value: str, max_age: int = SESSION_SECONDS) -> str:
        secure = "; Secure" if COOKIE_SECURE else ""
        return f"air_space_session={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}{secure}"

    def admin_login(self) -> None:
        try:
            payload = self.read_json()
            email = clean_text(payload.get("email"), 254, required=True).lower()
            password = clean_text(payload.get("password"), 200, required=True)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        ip = self.client_address[0]
        attempts, blocked_until = LOGIN_FAILURES.get(ip, (0, 0))
        now = time.time()
        if blocked_until > now:
            self.send_json({"error": "Trop de tentatives. Réessayez dans quelques minutes."}, 429)
            return
        with database() as db:
            row = db.execute("SELECT * FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
        if not row or not row["active"] or not verify_password(password, row["password_hash"]):
            attempts += 1
            LOGIN_FAILURES[ip] = (0, now + 600) if attempts >= 6 else (attempts, 0)
            self.send_json({"error": "E-mail ou mot de passe incorrect."}, 401)
            return
        LOGIN_FAILURES.pop(ip, None)
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = (row["id"], now + SESSION_SECONDS)
        self.send_json({"ok": True, "must_change_password": bool(row["must_change_password"])}, headers={"Set-Cookie": self.session_cookie(token)})

    def setup_owner(self) -> None:
        if not ALLOW_SETUP:
            self.send_json({"error": "La création initiale de compte est désactivée sur ce serveur."}, 403)
            return
        try:
            payload = self.read_json()
            setup_key = os.environ.get("AIR_SPACE_SETUP_KEY", "")
            if os.environ.get("RENDER") and not setup_key:
                self.send_json({"error": "La clé de première configuration doit être définie dans les variables privées Render."}, 403)
                return
            if setup_key and not secrets.compare_digest(str(payload.get("setup_key", "")), setup_key):
                self.send_json({"error": "La clé de première configuration est incorrecte."}, 403)
                return
            name = clean_text(payload.get("name"), 100, required=True)
            email = clean_text(payload.get("email"), 254, required=True).lower()
            password = payload.get("password")
            confirmation = payload.get("confirmation")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                raise ValueError("L’adresse e-mail semble invalide.")
            if not isinstance(password, str) or len(password) < 12:
                raise ValueError("Le mot de passe doit contenir au moins 12 caractères.")
            if password != confirmation:
                raise ValueError("Les deux mots de passe ne correspondent pas.")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        try:
            with database() as db:
                # database() inserts default settings before yielding, which opens
                # an implicit SQLite transaction. Commit that setup before starting
                # the explicit lock used to prevent two first-owner accounts.
                db.commit()
                db.execute("BEGIN IMMEDIATE")
                has_owner = db.execute("SELECT 1 FROM users WHERE role='owner' AND active=1 LIMIT 1").fetchone()
                if has_owner:
                    self.send_json({"error": "Le compte propriétaire existe déjà."}, 409)
                    return
                cursor = db.execute("INSERT INTO users(name,email,password_hash,role,active,must_change_password,created_at) VALUES(?,?,?,'owner',1,0,?)", (name,email,hash_password(password),now_iso()))
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            self.send_json({"error": "Un compte existe déjà avec cette adresse e-mail."}, 409)
            return
        except sqlite3.Error as exc:
            print(f"Erreur SQLite pendant la création du compte propriétaire : {exc!r}", flush=True)
            self.send_json({"error": "La base de données n’a pas pu enregistrer le compte. Consulte la fenêtre noire."}, 500)
            return
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = (user_id, time.time() + SESSION_SECONDS)
        self.audit(user_id, "owner.created", "user", str(user_id))
        self.send_json({"ok": True}, 201, headers={"Set-Cookie": self.session_cookie(token)})

    def create_reservation(self) -> None:
        ip = self.client_address[0]
        now = time.time()
        attempts = [stamp for stamp in PUBLIC_REQUESTS.get(ip, []) if now - stamp < 3600]
        if len(attempts) >= 8:
            self.send_json({"error": "Trop de demandes ont été envoyées. Réessayez plus tard."}, 429)
            return
        try:
            data = self.read_json()
            with database() as db:
                settings = settings_dict(db)
                if settings.get("booking_enabled", "1") != "1":
                    raise ValueError("Les réservations sont momentanément fermées.")
                name = clean_text(data.get("name"), 100, required=True)
                email = clean_text(data.get("email"), 254, required=True)
                if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                    raise ValueError("L’adresse e-mail semble invalide.")
                phone = clean_text(data.get("phone"), 30)
                event_date = clean_text(data.get("date"), 10, required=True)
                try:
                    parsed_date = date.fromisoformat(event_date)
                except ValueError as exc:
                    raise ValueError("La date choisie est invalide.") from exc
                if parsed_date < date.today():
                    raise ValueError("Choisissez une date à venir.")
                city = clean_text(data.get("city"), 100, required=True)
                age = optional_integer(data.get("age"), 1, 18, "âge")
                guests = optional_integer(data.get("guests"), 1, 100, "nombre d’invités")
                requested_setup_finish_time = clean_text(data.get("requested_setup_finish_time"), 5)
                if requested_setup_finish_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", requested_setup_finish_time):
                    raise ValueError("L’heure de fin d’installation doit être au format heures et minutes.")
                requested_finish_time = clean_text(data.get("requested_finish_time"), 5)
                if requested_finish_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", requested_finish_time):
                    raise ValueError("L’heure limite de fin doit être au format heures et minutes.")
                details = clean_text(data.get("details"), 1500)
                rocket_color = clean_text(data.get("rocket_color", "#3978b8"), 7).lower() or "#3978b8"
                if not re.fullmatch(r"#[0-9a-f]{6}", rocket_color):
                    raise ValueError("La couleur choisie pour la fusée est invalide.")
                rocket_body_color = clean_text(data.get("rocket_body_color", "#b86b2c"), 7).lower() or "#b86b2c"
                if not re.fullmatch(r"#[0-9a-f]{6}", rocket_body_color):
                    raise ValueError("La couleur choisie pour le corps de la fusée est invalide.")
                rocket_theme = clean_text(data.get("rocket_theme", "etoiles"), 20) or "etoiles"
                if rocket_theme not in {"etoiles", "planetes", "galaxie", "exploration"}:
                    raise ValueError("Le thème choisi pour la fusée est invalide.")
                rocket_name = clean_text(data.get("rocket_name"), 40)
                rocket_message = clean_text(data.get("rocket_message"), 100)
                if data.get("consent") is not True:
                    raise ValueError("Votre accord est nécessaire pour traiter la demande.")
                offer_id = optional_integer(data.get("offer_id"), 1, 1_000_000_000, "formule")
                offer_name, price_cents = "", None
                customization_allowed = False
                if offer_id is not None:
                    offer = db.execute("SELECT name,price_cents,customization_allowed FROM offers WHERE id=? AND active=1", (offer_id,)).fetchone()
                    if not offer:
                        raise ValueError("La formule choisie n’est plus disponible.")
                    offer_name, price_cents = offer["name"], offer["price_cents"]
                    customization_allowed = bool(offer["customization_allowed"])
                has_customization = (rocket_color != "#3978b8" or rocket_body_color != "#b86b2c" or rocket_theme != "etoiles" or bool(rocket_name) or bool(rocket_message))
                if has_customization and not customization_allowed:
                    raise ValueError("La formule choisie ne permet pas la personnalisation de la fusée.")
                cursor = db.execute(
                    "INSERT INTO reservations (name,email,phone,event_date,city,age,guests,details,status,created_at,offer_id,offer_name,offer_price_cents,rocket_color,rocket_body_color,rocket_theme,rocket_name,rocket_message,requested_setup_finish_time,requested_finish_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (name,email,phone,event_date,city,age,guests,details,"new",now_iso(),offer_id,offer_name,price_cents,rocket_color,rocket_body_color,rocket_theme,rocket_name,rocket_message,requested_setup_finish_time,requested_finish_time),
                )
                reservation_id = cursor.lastrowid
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        attempts.append(now)
        PUBLIC_REQUESTS[ip] = attempts
        self.send_json({"ok": True, "id": reservation_id, "name": name}, 201)

    def create_shop_order(self) -> None:
        ip = self.client_address[0]
        attempts = [t for t in PUBLIC_REQUESTS.get(ip, []) if t > time.time() - 3600]
        if len(attempts) >= 12:
            self.send_json({"error":"Trop de demandes. Réessayez plus tard."}, 429); return
        try:
            data = self.read_json()
            if data.get("consent") is not True:
                raise ValueError("Votre accord est nécessaire pour traiter la demande.")
            name = clean_text(data.get("name"), 100, required=True)
            email = clean_text(data.get("email"), 254, required=True).lower()
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email): raise ValueError("Adresse e-mail invalide.")
            product_id = optional_integer(data.get("product_id"), 1, 1_000_000_000, "article")
            quantity = optional_integer(data.get("quantity", 1), 1, 20, "quantité") or 1
            with database() as db:
                product = db.execute("SELECT id,name FROM products WHERE id=? AND active=1", (product_id,)).fetchone()
                if not product: raise ValueError("Cet article n’est plus disponible.")
                cur = db.execute("INSERT INTO shop_orders(product_id,product_name,customer_name,email,quantity,status,created_at) VALUES(?,?,?,?,?,'new',?)", (product_id,product["name"],name,email,quantity,now_iso()))
                order_id = cur.lastrowid
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"error": str(exc) if isinstance(exc, ValueError) else "La demande n’a pas pu être enregistrée."}, 400); return
        attempts.append(time.time()); PUBLIC_REQUESTS[ip] = attempts
        self.send_json({"ok":True,"id":order_id}, 201)

    def cast_vote(self) -> None:
        try:
            data=self.read_json(); vote_id=optional_integer(data.get("vote_id"),1,1_000_000_000,"vote"); client_id=clean_text(data.get("client_id"),36,required=True)
            if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",client_id): raise ValueError("Identifiant de visite invalide.")
            with database() as db:
                db.execute("INSERT INTO vote_receipts(client_id,vote_id,created_at) VALUES(?,?,?)",(client_id,vote_id,now_iso()))
                cur=db.execute("UPDATE votes SET votes=votes+1 WHERE id=? AND active=1",(vote_id,))
                if not cur.rowcount: raise ValueError("Ce vote n’est plus ouvert.")
                count=db.execute("SELECT votes FROM votes WHERE id=?",(vote_id,)).fetchone()[0]
            self.send_json({"ok":True,"votes":count})
        except sqlite3.IntegrityError:self.send_json({"error":"Un seul vote par idée et par appareil est accepté."},409)
        except (ValueError,sqlite3.Error) as exc:self.send_json({"error":str(exc) if isinstance(exc,ValueError) else "Vote impossible."},400)

    def submit_community_idea(self) -> None:
        try:
            data=self.read_json(); nickname=clean_text(data.get("nickname"),40) or "Visiteur Air Space"; idea=clean_text(data.get("idea"),500,required=True)
            ip=self.client_address[0];now=time.time();recent=[t for t in PUBLIC_REQUESTS.get("idea:"+ip,[]) if t>now-3600]
            if len(recent)>=5:self.send_json({"error":"Limite de suggestions atteinte. Réessayez plus tard."},429);return
            with database() as db:cur=db.execute("INSERT INTO community_ideas(nickname,idea,status,created_at) VALUES(?,?,'pending',?)",(nickname,idea,now_iso()))
            recent.append(now);PUBLIC_REQUESTS["idea:"+ip]=recent;self.send_json({"ok":True,"id":cur.lastrowid},201)
        except (ValueError,sqlite3.Error) as exc:self.send_json({"error":str(exc) if isinstance(exc,ValueError) else "Suggestion impossible."},400)

    def airbot_answer(self) -> None:
        try:
            raw_question=clean_text(self.read_json().get("question"),300,required=True)
            question=unicodedata.normalize("NFKD",raw_question.casefold())
            question="".join(char for char in question if not unicodedata.combining(char))
            tokens=set(re.findall(r"[a-z0-9]+",question))
            # AirBot answers from Air Space's own published data and team-approved FAQ.
            # It intentionally declines unrelated topics and never invents prices or dates.
            intent_terms={
                "prices":{"prix","tarif","tarifs","combien","cout","coût","coute","euros","formule","formules","cher"},
                "events":{"date","dates","agenda","spectacle","spectacles","public","mission","missions","prochain","prochaine","quand","lieu"},
                "videos":{"video","videos","voir","regarder","decollage","decollages","exemple","exemples"},
                "booking":{"reservation","reserver","demande","anniversaire","anniversaires","organiser","disponible","disponibilite","invites"},
                "rocket":{"fusee","fusees","fusée","fusées","bouteille","bouteilles","recycle","impression","imprimee","3d","eau","air","fabrication","fonctionnement"},
                "custom":{"personnaliser","personnalisation","couleur","theme","nom","decoration","decorer","message"},
                "shop":{"boutique","article","articles","acheter","commande","commander","creations","creation","objet","objets","produit","produits"},
                "contact":{"contact","contacter","email","mail","telephone","tel","equipe","joindre"},
                "donation":{"don","donner","donation","dons","soutenir","soutien"},
                "accounts":{"compte","comptes","inscription","inscrire","connexion","connecter","visiteur","equipe","equipe"},
                "safety":{"securite","securitaire","adulte","adultes","risque","autorisation","encadrement"},
                "about":{"air","space","projet","air-space","histoire","equipe","qui","etes","vous"},
                "airlab":{"airbot","air-vote","air-points","ecotracker","points","vote","votes","idee","idees","communaute","defi","defis","recyclage","recycler"},
            }
            intent_scores={name:len(tokens & terms) for name,terms in intent_terms.items()}
            best_intent=max(intent_scores,key=intent_scores.get)
            best_score=intent_scores[best_intent]
            with database() as db:
                settings=settings_dict(db)
                custom=db.execute("SELECT keywords,answer FROM bot_answers WHERE active=1 ORDER BY id DESC").fetchall()
                offers=db.execute("SELECT name,description,price_cents,duration_minutes FROM offers WHERE active=1 ORDER BY sort_order,id").fetchall()
                events=db.execute("SELECT title,event_date,event_time,city,venue FROM public_events WHERE public=1 AND event_date>=date('now') ORDER BY event_date,event_time LIMIT 5").fetchall()
                videos=db.execute("SELECT title,video_url FROM launch_videos WHERE active=1 ORDER BY id DESC LIMIT 5").fetchall()
                products=db.execute("SELECT name,price_cents FROM products WHERE active=1 ORDER BY id DESC LIMIT 6").fetchall()
                knowledge=db.execute("SELECT title,body FROM public_pages WHERE published=1 UNION ALL SELECT title,body FROM news WHERE published=1 ORDER BY title LIMIT 80").fetchall()
            fallback=settings.get("airbot_fallback","Je peux vous aider sur les spectacles, les réservations, les tarifs et les actualités Air Space.")
            # Team-authored FAQ takes precedence when several of its keywords match.
            best_custom=None; custom_score=0
            for item in custom:
                score=0
                for phrase in item["keywords"].split(","):
                    key=unicodedata.normalize("NFKD",phrase.strip().casefold())
                    key="".join(char for char in key if not unicodedata.combining(char))
                    parts=set(re.findall(r"[a-z0-9]+",key))
                    useful=parts-{"air","space","airspace","est","sont","une","des","les","pour","avec","dans","quoi","comment","quel","quelle","quels","quelles"}
                    if useful and useful & tokens: score+=len(useful & tokens)*2+(2 if useful.issubset(tokens) else 0)
                if score>custom_score: best_custom,custom_score=item["answer"],score
            best_knowledge=None; knowledge_score=0
            for item in knowledge:
                words=set(re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",(item["title"]+" "+item["body"]).casefold()).encode("ascii","ignore").decode()))
                score=len((tokens-{"air","space","airspace","est","sont","une","des","les","pour","avec","dans","quoi","comment","quel","quelle","quels","quelles"}) & words)
                if score>knowledge_score: best_knowledge,knowledge_score=item,score
            if best_custom and custom_score>=max(2,best_score):
                answer=best_custom
            elif best_knowledge and knowledge_score>=2:
                answer=f"{best_knowledge['title']} — {best_knowledge['body']} Pour une précision supplémentaire, contactez l’équipe via la rubrique Contact."
            elif best_score==0:
                answer="Je réponds uniquement aux questions liées à Air Space. "+fallback
            elif best_intent=="prices":
                if offers:
                    lines=[f"• {row['name']} : {row['price_cents']/100:.2f} €"+(f" · {row['duration_minutes']} min" if row['duration_minutes'] else "") for row in offers]
                    answer="Voici les formules actuellement publiées :\n"+"\n".join(lines)+"\nUne demande ne confirme pas encore la réservation ; l’équipe vous recontactera."
                else: answer=f"Les tarifs ne sont pas encore publiés. {settings.get('price_note','')} Vous pouvez envoyer une demande de spectacle sans engagement."
            elif best_intent=="events":
                answer="Voici les prochains spectacles publics annoncés :\n"+"\n".join(f"• {row['title']} — {row['event_date']}"+(f" à {row['event_time']}" if row['event_time'] else "")+(f" · {row['venue']}" if row['venue'] else "")+(f" ({row['city']})" if row['city'] else "") for row in events) if events else "Aucun spectacle public n’est annoncé pour le moment. Consultez l’agenda Air Space plus tard : l’équipe y publie les nouvelles dates."
            elif best_intent=="videos":
                answer="Exemples de décollages publiés par Air Space :\n"+"\n".join(f"• {row['title']} — {row['video_url']}" for row in videos) if videos else "La galerie de décollages sera renseignée par l’équipe dès que les premières vidéos pourront être partagées. Retrouvez-la dans la rubrique Vidéos du site."
            elif best_intent=="booking":
                answer="Vous pouvez envoyer une demande depuis la rubrique Réserver, sans créer de compte. Indiquez la date, la ville, le nombre d’invités et les heures souhaitées pour terminer l’installation et le spectacle. L’équipe vérifie ensuite la disponibilité et vous confirme les détails."
            elif best_intent=="rocket":
                answer=f"{settings.get('concept_description','Air Space imagine des démonstrations de mini-fusées à air et à eau.') } {settings.get('safety_description','Les démonstrations se préparent avec des adultes responsables et un lieu adapté.')} Pour toute question sur un spectacle, écrivez à {settings.get('public_email','Air-Space_08@hotmail.com')}."
            elif best_intent=="custom":
                answer=f"La demande de spectacle permet de proposer un nom, un message, un thème et des couleurs pour imaginer la fusée d’anniversaire. {settings.get('customizer_description','L’équipe vous répondra pour confirmer ce qui est réalisable.')}"
            elif best_intent=="shop":
                answer="La boutique propose actuellement : "+(" ; ".join(f"{row['name']} ({row['price_cents']/100:.2f} €)" for row in products) if products else "aucun article publié pour le moment")+". Vous pouvez envoyer une demande sans compte ; l’équipe confirmera la disponibilité. Aucun paiement n’est pris sur le site."
            elif best_intent=="contact":
                answer=f"Pour joindre l’équipe Air Space : {settings.get('public_email','Air-Space_08@hotmail.com')}"+(f" · {settings['public_phone']}" if settings.get('public_phone') else ". Le numéro de téléphone n’est pas encore renseigné.")
            elif best_intent=="donation":
                answer=f"{settings.get('donation_description','Les informations de soutien sont préparées par l’équipe.') }"+(f" Bénéficiaire : {settings['donation_account_name']}." if settings.get('donation_account_name') else " Les coordonnées de réception ne sont pas encore configurées ; n’envoyez pas d’argent à une autre adresse.")
            elif best_intent=="accounts":
                answer="Les visiteurs peuvent consulter le site, faire une demande et participer aux activités sans compte. Seuls les membres autorisés disposent d’un accès personnel à l’espace équipe."
            elif best_intent=="safety":
                answer=settings.get('safety_description','Les démonstrations sont préparées avec des adultes responsables et dans un lieu adapté.')
            elif best_intent=="airlab":
                answer="Air Lab regroupe Air-Vote (choisir les prochaines idées), Air-Points (défis pour le plaisir), EcoTracker (matériaux réutilisés), les suggestions relues par l’équipe et AirBot. Tout cela est accessible sans compte visiteur."
            else:
                answer=f"{settings.get('concept_description','Air Space prépare des spectacles de mini-fusées à air et à eau dans le Rhône, autour de Lyon.')} {settings.get('concept_followup','') }"
            self.send_json({"answer":answer,"assistant":"AirBot","scope":"air-space","sources":["informations du site","contenus validés par l’équipe"]})
        except ValueError as exc:self.send_json({"error":str(exc)},400)

    def complete_challenge(self) -> None:
        try:
            data=self.read_json(); client_id=clean_text(data.get("client_id"),36,required=True); challenge_id=optional_integer(data.get("challenge_id"),1,1_000_000_000,"mission"); answer=clean_text(data.get("answer"),300,required=True).strip().casefold()
            if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",client_id): raise ValueError("Identifiant de visite invalide.")
            with database() as db:
                challenge=db.execute("SELECT answer,reward_points FROM air_challenges WHERE id=? AND active=1",(challenge_id,)).fetchone()
                if not challenge: raise ValueError("Cette mission n’est plus disponible.")
                if answer != challenge["answer"].strip().casefold(): raise ValueError("Ce n’est pas la bonne réponse. Réessaie !")
                db.execute("INSERT INTO challenge_completions(client_id,challenge_id,completed_at) VALUES(?,?,?)",(client_id,challenge_id,now_iso()))
                reward=int(challenge["reward_points"])
                db.execute("INSERT INTO point_wallets(client_id,points,updated_at) VALUES(?,?,?) ON CONFLICT(client_id) DO UPDATE SET points=point_wallets.points+excluded.points,updated_at=excluded.updated_at",(client_id,reward,now_iso()))
                points=db.execute("SELECT points FROM point_wallets WHERE client_id=?",(client_id,)).fetchone()[0]
        except sqlite3.IntegrityError:
            self.send_json({"error":"Cette mission a déjà été validée sur cet appareil."},409); return
        except (ValueError,sqlite3.Error) as exc:
            self.send_json({"error":str(exc) if isinstance(exc,ValueError) else "La mission n’a pas pu être validée."},400); return
        self.send_json({"ok":True,"reward":reward,"points":points})

    def moderate_idea(self, idea_id: int) -> None:
        user=self.permission("shop:write")
        if not user:return
        try:
            status=clean_text(self.read_json().get("status"),20,required=True)
            if status not in {"approved","rejected","pending"}:raise ValueError("Décision invalide.")
            with database() as db:cur=db.execute("UPDATE community_ideas SET status=? WHERE id=?",(status,idea_id))
            if not cur.rowcount:self.send_json({"error":"Suggestion introuvable."},404);return
        except ValueError as exc:self.send_json({"error":str(exc)},400);return
        self.send_json({"ok":True})

    def update_shop_order(self, order_id: int) -> None:
        user=self.permission("shop:write")
        if not user:return
        try:
            status=clean_text(self.read_json().get("status"),20,required=True)
            if status not in {"new","contacted","confirmed","declined"}:raise ValueError("État de commande invalide.")
            with database() as db:cur=db.execute("UPDATE shop_orders SET status=? WHERE id=?",(status,order_id))
            if not cur.rowcount:self.send_json({"error":"Demande introuvable."},404);return
        except ValueError as exc:self.send_json({"error":str(exc)},400);return
        self.send_json({"ok":True})

    def upload_video(self) -> None:
        user = self.permission("shop:write")
        if not user: return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 50 * 1024 * 1024:
                self.send_json({"error": "La vidéo doit faire moins de 50 Mo."}, 413); return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;"):
                raise ValueError("Choisissez un fichier vidéo MP4 ou WebM.")
            headers = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii", "strict")
            message = BytesParser(policy=email_policy).parsebytes(headers + self.rfile.read(length))
            fields = {}
            for part in message.iter_parts():
                key = part.get_param("name", header="content-disposition")
                if key == "file": fields["file"] = (part.get_filename() or "", part.get_payload(decode=True) or b"")
                elif key in {"title", "description"}: fields[key] = (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
            title = clean_text(fields.get("title"), 120, required=True)
            description = clean_text(fields.get("description"), 1000)
            original_name, payload = fields.get("file", ("", b""))
            extension = Path(original_name.replace("\\", "/")).suffix.lower()
            if extension not in {".mp4", ".webm"} or not payload or len(payload) > 50 * 1024 * 1024:
                raise ValueError("Choisissez un fichier MP4 ou WebM de moins de 50 Mo.")
            filename = secrets.token_hex(16) + extension
            VIDEO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            (VIDEO_UPLOAD_DIR / filename).write_bytes(payload)
            url = f"/media/videos/{filename}"
            try:
                with database() as db:
                    cursor = db.execute("INSERT INTO launch_videos(title,description,video_url,active,created_at) VALUES(?,?,?,1,?)", (title, description, url, now_iso()))
                    video_id = cursor.lastrowid
            except Exception:
                (VIDEO_UPLOAD_DIR / filename).unlink(missing_ok=True)
                raise
        except (ValueError, UnicodeError) as exc:
            self.send_json({"error": str(exc)}, 400); return
        except Exception as exc:
            print(f"Erreur pendant l’ajout de vidéo : {exc!r}", flush=True)
            self.send_json({"error": "La vidéo n’a pas pu être enregistrée."}, 500); return
        self.audit(user["id"], "video.uploaded", "video", str(video_id))
        self.send_json({"ok": True, "id": video_id, "video_url": url}, 201)

    def save_content_item(self, kind: str | None = None, item_id: int | None = None) -> None:
        user = self.permission("shop:write")
        if not user: return
        try:
            data = self.read_json()
            kind = kind or clean_text(data.get("kind"), 20, required=True)
            if kind not in {"products","events","videos","votes","eco","news","partners","challenges","bot_answers","pages"}: raise ValueError("Type de contenu inconnu.")
            if kind == "products":
                name=clean_text(data.get("name"),100,required=True); desc=clean_text(data.get("description"),1000); price=optional_integer(data.get("price_cents"),0,100000000,"prix"); image=clean_text(data.get("image_url"),500); active=1 if data.get("active",True) else 0
                if image and not image.startswith("https://"): raise ValueError("L’image doit utiliser une adresse HTTPS.")
                table="products"; columns=("name","description","price_cents","image_url","active"); values=(name,desc,price or 0,image,active)
            elif kind == "events":
                name=clean_text(data.get("title"),120,required=True); desc=clean_text(data.get("description"),1000); day=clean_text(data.get("event_date"),10,required=True); event_time=clean_text(data.get("event_time"),5); city=clean_text(data.get("city"),100); venue=clean_text(data.get("venue"),160); public=1 if data.get("public",True) else 0
                date.fromisoformat(day)
                table="public_events"; columns=("title","description","event_date","event_time","city","venue","public"); values=(name,desc,day,event_time,city,venue,public)
            elif kind == "videos":
                name=clean_text(data.get("title"),120,required=True); desc=clean_text(data.get("description"),1000); url=clean_text(data.get("video_url"),500,required=True)
                parsed=urlparse(url)
                accepted_host=parsed.scheme=="https" and parsed.hostname and (parsed.hostname.endswith("youtube.com") or parsed.hostname=="youtu.be" or parsed.hostname.endswith("vimeo.com"))
                accepted_file=parsed.scheme=="https" and Path(parsed.path).suffix.lower() in {".mp4",".webm"}
                accepted_upload=bool(re.fullmatch(r"/media/videos/[a-f0-9]{32}\.(?:mp4|webm)",url))
                if not (accepted_host or accepted_file or accepted_upload): raise ValueError("Utilise YouTube/Vimeo, un lien MP4/WebM HTTPS ou un fichier importé dans Air Space.")
                table="launch_videos"; columns=("title","description","video_url","active"); values=(name,desc,url,1)
            elif kind == "votes":
                name=clean_text(data.get("idea"),200,required=True); table="votes"; columns=("idea","votes","active"); values=(name,0,1)
            elif kind == "eco":
                name=clean_text(data.get("material"),80,required=True); quantity=float(data.get("quantity",0)); unit=clean_text(data.get("unit"),15,required=True); note=clean_text(data.get("note"),300)
                if not 0 < quantity <= 100000: raise ValueError("La quantité doit être supérieure à zéro.")
                if unit not in {"kg","g","pièces","L"}: raise ValueError("Unité non reconnue.")
                table="eco_records"; columns=("material","quantity","unit","note"); values=(name,quantity,unit,note)
            elif kind == "news":
                name=clean_text(data.get("title"),120,required=True); body=clean_text(data.get("body"),3000,required=True); table="news"; columns=("title","body","published"); values=(name,body,1)
            elif kind == "partners":
                name=clean_text(data.get("name"),120,required=True); desc=clean_text(data.get("description"),1000); url=clean_text(data.get("url"),500)
                if url and not url.startswith("https://"): raise ValueError("Le lien partenaire doit utiliser HTTPS.")
                table="partners"; columns=("name","description","url","published"); values=(name,desc,url,1)
            elif kind == "challenges":
                name=clean_text(data.get("title"),120,required=True); question=clean_text(data.get("question"),500,required=True); answer=clean_text(data.get("answer"),120,required=True); reward=optional_integer(data.get("reward_points"),1,100,"points") or 5
                table="air_challenges"; columns=("title","question","answer","reward_points","active"); values=(name,question,answer,reward,1)
            elif kind == "bot_answers":
                keywords=clean_text(data.get("keywords"),300,required=True); answer=clean_text(data.get("answer"),800,required=True)
                table="bot_answers"; columns=("keywords","answer","active"); values=(keywords,answer,1)
            else:
                page_key=clean_text(data.get("page_key"),30,required=True)
                if page_key not in {"about","faq","recruitment","legal","privacy","other"}: raise ValueError("Type de page invalide.")
                name=clean_text(data.get("title"),120,required=True); body=clean_text(data.get("body"),5000,required=True)
                table="public_pages"; columns=("page_key","title","body","published"); values=(page_key,name,body,1)
            with database() as db:
                if item_id:
                    db.execute(f"UPDATE {table} SET " + ",".join(f"{col}=?" for col in columns) + " WHERE id=?", (*values,item_id))
                else:
                    db.execute(f"INSERT INTO {table} (" + ",".join(columns) + ",created_at) VALUES(" + ",".join("?" for _ in range(len(values)+1)) + ")", (*values,now_iso()))
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"error": str(exc) if isinstance(exc, ValueError) else "Enregistrement impossible."}, 400); return
        self.send_json({"ok":True})

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/admin/shop/orders/(\d+)", path)
        if match:
            self.update_shop_order(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/reservations/(\d+)", path)
        if match:
            self.update_reservation(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/expenses/(\d+)", path)
        if match:
            self.save_expense(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/offers/(\d+)", path)
        if match:
            self.save_offer(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/settings", path)
        if match:
            self.update_settings()
            return
        match = re.fullmatch(r"/api/admin/budget", path)
        if match:
            self.update_budget_limit()
            return
        match = re.fullmatch(r"/api/admin/users/(\d+)", path)
        if match:
            self.update_user(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/content/(products|events|videos|votes|eco|news|partners|challenges|bot_answers|pages)/(\d+)", path)
        if match:
            self.save_content_item(match.group(1), int(match.group(2)))
            return
        match = re.fullmatch(r"/api/admin/community/ideas/(\d+)", path)
        if match:
            self.moderate_idea(int(match.group(1)))
            return
        self.send_json({"error": "Page introuvable."}, 404)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/admin/reservations/(\d+)", path)
        if match:
            self.delete_reservation(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/expenses/(\d+)", path)
        if match:
            self.delete_expense(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/users/(\d+)", path)
        if match:
            self.delete_user(int(match.group(1)))
            return
        match = re.fullmatch(r"/api/admin/content/(products|events|videos|votes|eco|news|partners|challenges|bot_answers|pages)/(\d+)", path)
        if match:
            user = self.permission("shop:write")
            if not user: return
            table = {"products":"products", "events":"public_events", "videos":"launch_videos", "votes":"votes", "eco":"eco_records", "news":"news", "partners":"partners", "challenges":"air_challenges", "bot_answers":"bot_answers", "pages":"public_pages"}[match.group(1)]
            video_path = None
            with database() as db:
                if match.group(1) == "videos":
                    row = db.execute("SELECT video_url FROM launch_videos WHERE id=?", (int(match.group(2)),)).fetchone()
                    if row and re.fullmatch(r"/media/videos/[a-f0-9]{32}\.(?:mp4|webm)", row["video_url"]): video_path = VIDEO_UPLOAD_DIR / Path(row["video_url"]).name
                db.execute(f"DELETE FROM {table} WHERE id=?", (int(match.group(2)),))
            if video_path: video_path.unlink(missing_ok=True)
            self.send_json({"ok": True})
            return
        if path == "/api/admin/me":
            self.delete_current_user()
            return
        self.send_json({"error": "Page introuvable."}, 404)

    def delete_reservation(self, reservation_id: int) -> None:
        user = self.permission("bookings:write")
        if not user:
            return
        try:
            with database() as db:
                db.commit()
                db.execute("BEGIN IMMEDIATE")
                reservation = db.execute("SELECT id,name,status FROM reservations WHERE id=?", (reservation_id,)).fetchone()
                if not reservation:
                    self.send_json({"error": "Réservation introuvable."}, 404)
                    return
                if reservation["status"] != "declined":
                    self.send_json({"error": "Seules les réservations refusées peuvent être supprimées."}, 409)
                    return
                db.execute("INSERT INTO audit_log(user_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?)", (user["id"], "reservation.deleted", "reservation", str(reservation_id), now_iso()))
                db.execute("DELETE FROM reservations WHERE id=? AND status='declined'", (reservation_id,))
        except sqlite3.Error as exc:
            print(f"Erreur SQLite pendant la suppression d’une réservation : {exc!r}", flush=True)
            self.send_json({"error": "La réservation n’a pas pu être supprimée. Consulte la fenêtre noire."}, 500)
            return
        self.send_json({"ok": True, "name": reservation["name"]})

    def save_expense(self, expense_id: int | None = None) -> None:
        user = self.permission("budget:write")
        if not user:
            return
        try:
            values = expense_values(self.read_json())
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            if expense_id is None:
                cursor = db.execute("INSERT INTO expenses(spent_on,description,category,amount_cents,status,details,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)", (values["spent_on"], values["description"], values["category"], values["amount_cents"], values["status"], values["details"], user["id"], now_iso()))
                saved_id = cursor.lastrowid
                action = "expense.created"
            else:
                db.execute("UPDATE expenses SET spent_on=?,description=?,category=?,amount_cents=?,status=?,details=? WHERE id=?", (values["spent_on"], values["description"], values["category"], values["amount_cents"], values["status"], values["details"], expense_id))
                saved_id = expense_id
                action = "expense.updated"
            row = db.execute("SELECT e.*,u.name AS author_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.id=?", (saved_id,)).fetchone()
        if row is None:
            self.send_json({"error": "Dépense introuvable."}, 404)
            return
        self.audit(user["id"], action, "expense", str(saved_id))
        self.send_json({"expense": dict(row)}, 201 if expense_id is None else 200)

    def delete_expense(self, expense_id: int) -> None:
        user = self.permission("budget:write")
        if not user:
            return
        with database() as db:
            row = db.execute("SELECT id,description FROM expenses WHERE id=?", (expense_id,)).fetchone()
            if row:
                db.execute("DELETE FROM expenses WHERE id=?", (expense_id,))
        if not row:
            self.send_json({"error": "Dépense introuvable."}, 404)
            return
        self.audit(user["id"], "expense.deleted", "expense", str(expense_id))
        self.send_json({"ok": True, "description": row["description"]})

    def update_budget_limit(self) -> None:
        user = self.permission("budget:write")
        if not user:
            return
        try:
            payload = self.read_json()
            limit = payload.get("budget_limit_cents")
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100_000_000:
                raise ValueError("Le plafond doit être supérieur à 0 € et inférieur à 1 000 000 €.")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            db.execute("INSERT INTO settings(key,value) VALUES('budget_limit_cents',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(limit),))
        self.audit(user["id"], "budget.limit.updated", "budget", str(limit))
        self.send_json({"ok": True, "budget_limit_cents": limit})

    def update_reservation(self, reservation_id: int) -> None:
        user = self.permission("bookings:write")
        if not user:
            return
        try:
            payload = self.read_json()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        updates = []
        values = []
        if "status" in payload:
            status = payload.get("status")
            if status not in STATUSES:
                self.send_json({"error": "Statut invalide."}, 400)
                return
            updates.append("status=?")
            values.append(status)
        if "event_time" in payload:
            try:
                event_time = clean_text(payload.get("event_time"), 5)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, 400)
                return
            if event_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", event_time):
                self.send_json({"error": "L’heure doit être au format heures et minutes, par exemple 14:30."}, 400)
                return
            updates.append("event_time=?")
            values.append(event_time)
        if not updates:
            self.send_json({"error": "Aucune modification à enregistrer."}, 400)
            return
        with database() as db:
            db.execute(f"UPDATE reservations SET {','.join(updates)} WHERE id=?", (*values, reservation_id))
            row = db.execute("SELECT * FROM reservations WHERE id=?", (reservation_id,)).fetchone()
        if row is None:
            self.send_json({"error": "Demande introuvable."}, 404)
            return
        self.audit(user["id"], "reservation.updated", "reservation", str(reservation_id))
        self.send_json({"reservation": dict(row)})

    def save_offer(self, offer_id: int | None = None) -> None:
        user = self.permission("offers:write")
        if not user:
            return
        try:
            data = self.read_json()
            name = clean_text(data.get("name"), 100, required=True)
            description = clean_text(data.get("description"), 700)
            price = data.get("price_euros")
            if price in (None, ""):
                price_cents = None
            else:
                try:
                    price_number = round(float(price), 2)
                except (TypeError, ValueError) as exc:
                    raise ValueError("Le tarif doit être un montant en euros.") from exc
                if price_number < 0 or price_number > 100_000:
                    raise ValueError("Le tarif doit être compris entre 0 € et 100 000 €.")
                price_cents = int(round(price_number * 100))
            duration = optional_integer(data.get("duration_minutes"), 1, 1440, "durée")
            active = 1 if data.get("active") is True else 0
            if active and price_cents is None:
                raise ValueError("Ajoutez un tarif avant de publier cette formule.")
            sort_order = optional_integer(data.get("sort_order", 0), 0, 10_000, "ordre") or 0
            customization_allowed = 1 if data.get("customization_allowed") is True else 0
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            if offer_id:
                db.execute("UPDATE offers SET name=?,description=?,price_cents=?,duration_minutes=?,active=?,sort_order=?,customization_allowed=? WHERE id=?", (name,description,price_cents,duration,active,sort_order,customization_allowed,offer_id))
                row = db.execute("SELECT * FROM offers WHERE id=?", (offer_id,)).fetchone()
            else:
                cursor = db.execute("INSERT INTO offers(name,description,price_cents,duration_minutes,active,sort_order,customization_allowed,created_at) VALUES(?,?,?,?,?,?,?,?)", (name,description,price_cents,duration,active,sort_order,customization_allowed,now_iso()))
                row = db.execute("SELECT * FROM offers WHERE id=?", (cursor.lastrowid,)).fetchone()
        if not row:
            self.send_json({"error": "Tarif introuvable."}, 404)
            return
        self.audit(user["id"], "offer.saved", "offer", str(row["id"]))
        self.send_json({"offer": offer_dict(row)})

    def update_settings(self) -> None:
        user = self.permission("settings:write")
        if not user:
            return
        try:
            data = self.read_json()
            allowed = {
                "company_name": (80, True), "tagline": (140, False), "service_area": (120, True),
                "public_email": (254, False), "public_phone": (30, False), "price_note": (240, True),
                "donation_account_name": (120, False), "donation_iban": (42, False),
                "hero_description": (300, True), "concept_description": (500, True), "concept_followup": (300, True),
                "customizer_description": (400, True), "booking_description": (400, True), "booking_disclaimer": (240, True),
                "step_one_note": (240, True), "step_two_note": (240, True), "step_three_note": (240, True),
                "safety_title": (180, True), "safety_description": (500, True),
                "contact_description": (300, True), "donation_description": (300, True),
                "airbot_fallback": (400, True),
            }
            values = {}
            for key, (limit, required) in allowed.items():
                values[key] = clean_text(data.get(key, ""), limit, required=required)
            if values["public_email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["public_email"]):
                raise ValueError("L’adresse e-mail publique semble invalide.")
            values["donation_iban"] = "".join(values["donation_iban"].split()).upper()
            if values["donation_iban"] and not valid_iban(values["donation_iban"]):
                raise ValueError("Vérifiez le numéro IBAN du compte bancaire.")
            if "booking_enabled" in data:
                if not isinstance(data["booking_enabled"], bool):
                    raise ValueError("Le réglage des réservations est invalide.")
                values["booking_enabled"] = "1" if data["booking_enabled"] else "0"
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            db.executemany("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", values.items())
            result = settings_dict(db)
        self.audit(user["id"], "settings.updated", "settings")
        self.send_json({"settings": result})

    def create_user(self) -> None:
        user = self.permission("team:write")
        if not user:
            return
        try:
            data = self.read_json()
            name = clean_text(data.get("name"), 100, required=True)
            email = clean_text(data.get("email"), 254, required=True).lower()
            role = data.get("role")
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                raise ValueError("L’adresse e-mail semble invalide.")
            if role not in ROLES or (role == "owner" and user["role"] != "owner"):
                raise ValueError("Ce rôle ne peut pas être attribué par votre compte.")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        temporary_password = secrets.token_urlsafe(15)
        try:
            with database() as db:
                cursor = db.execute("INSERT INTO users(name,email,password_hash,role,active,must_change_password,created_at) VALUES(?,?,?,?,1,1,?)", (name,email,hash_password(temporary_password),role,now_iso()))
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            self.send_json({"error": "Un compte existe déjà avec cette adresse e-mail."}, 409)
            return
        self.audit(user["id"], "user.created", "user", str(user_id))
        self.send_json({"user": {"id": user_id, "name": name, "email": email, "role": role, "active": True}, "temporary_password": temporary_password}, 201)

    def update_user(self, target_id: int) -> None:
        user = self.permission("team:write")
        if not user:
            return
        if target_id == user["id"]:
            self.send_json({"error": "Vous ne pouvez pas désactiver ou modifier votre propre rôle ici."}, 400)
            return
        try:
            data = self.read_json()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            target = db.execute("SELECT * FROM users WHERE id=?", (target_id,)).fetchone()
            if not target:
                self.send_json({"error": "Compte introuvable."}, 404)
                return
            if target["role"] == "owner" and user["role"] != "owner":
                self.send_json({"error": "Seul le propriétaire peut modifier un compte propriétaire."}, 403)
                return
            role = data.get("role", target["role"])
            active = data.get("active", bool(target["active"]))
            if role not in ROLES or not isinstance(active, bool):
                self.send_json({"error": "Rôle ou état de compte invalide."}, 400)
                return
            if role == "owner" and user["role"] != "owner":
                self.send_json({"error": "Seul le propriétaire peut attribuer le rôle propriétaire."}, 403)
                return
            if target["role"] == "owner" and (role != "owner" or not active):
                active_owners = db.execute("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1 AND id!=?", (target_id,)).fetchone()["n"]
                if active_owners == 0:
                    self.send_json({"error": "Gardez au moins un compte propriétaire actif."}, 400)
                    return
            db.execute("UPDATE users SET role=?,active=? WHERE id=?", (role, 1 if active else 0, target_id))
            updated = db.execute("SELECT id,name,email,role,active,created_at FROM users WHERE id=?", (target_id,)).fetchone()
        if not active:
            for token, session in list(SESSIONS.items()):
                if session[0] == target_id:
                    SESSIONS.pop(token, None)
        self.audit(user["id"], "user.updated", "user", str(target_id))
        self.send_json({"user": dict(updated)})

    def delete_user(self, target_id: int) -> None:
        user = self.permission("team:write")
        if not user:
            return
        if user["role"] != "owner":
            self.send_json({"error": "Seul le directeur peut supprimer les comptes des autres membres."}, 403)
            return
        if target_id == user["id"]:
            self.send_json({"error": "Pour supprimer votre propre compte, utilisez la page « Mon mot de passe » puis sa section de suppression."}, 400)
            return
        try:
            with database() as db:
                db.commit()
                db.execute("BEGIN IMMEDIATE")
                target = db.execute("SELECT id,name,role,active FROM users WHERE id=?", (target_id,)).fetchone()
                if not target:
                    self.send_json({"error": "Compte introuvable."}, 404)
                    return
                if target["role"] == "owner":
                    other_active_owners = db.execute("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1 AND id!=?", (target_id,)).fetchone()["n"]
                    if other_active_owners == 0:
                        self.send_json({"error": "Impossible de supprimer le dernier compte propriétaire actif. Crée d’abord un autre compte propriétaire."}, 409)
                        return
                db.execute("INSERT INTO audit_log(user_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?)", (user["id"], "user.deleted", "user", str(target_id), now_iso()))
                db.execute("DELETE FROM users WHERE id=?", (target_id,))
        except sqlite3.Error as exc:
            print(f"Erreur SQLite pendant la suppression d’un compte : {exc!r}", flush=True)
            self.send_json({"error": "Le compte n’a pas pu être supprimé. Consulte la fenêtre noire."}, 500)
            return
        for token, session in list(SESSIONS.items()):
            if session[0] == target_id:
                SESSIONS.pop(token, None)
        self.send_json({"ok": True, "name": target["name"]})

    def delete_current_user(self) -> None:
        user = self.session_user()
        if not user:
            self.send_json({"error": "Connexion requise."}, 401)
            return
        try:
            data = self.read_json()
            current = clean_text(data.get("current_password"), 200, required=True)
            if data.get("confirmation") is not True:
                raise ValueError("Coche la confirmation pour supprimer ton compte.")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            db.commit()
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT password_hash,role FROM users WHERE id=? AND active=1", (user["id"],)).fetchone()
            if not row or not verify_password(current, row["password_hash"]):
                self.send_json({"error": "Le mot de passe actuel est incorrect."}, 401)
                return
            db.execute("INSERT INTO audit_log(user_id,action,target_type,target_id,created_at) VALUES(?,?,?,?,?)", (user["id"], "user.self_deleted", "user", str(user["id"]), now_iso()))
            db.execute("DELETE FROM users WHERE id=?", (user["id"],))
        for token, session in list(SESSIONS.items()):
            if session[0] == user["id"]:
                SESSIONS.pop(token, None)
        self.send_json({"ok": True}, headers={"Set-Cookie": self.session_cookie("", max_age=0)})

    def change_password(self) -> None:
        user = self.session_user()
        if not user:
            self.send_json({"error": "Connexion requise."}, 401)
            return
        try:
            data = self.read_json()
            current = clean_text(data.get("current_password"), 200, required=True)
            new_password = clean_text(data.get("new_password"), 200, required=True)
            if len(new_password) < 12:
                raise ValueError("Le nouveau mot de passe doit contenir au moins 12 caractères.")
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with database() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
            if not verify_password(current, row["password_hash"]):
                self.send_json({"error": "Le mot de passe actuel est incorrect."}, 401)
                return
            db.execute("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?", (hash_password(new_password), user["id"]))
        self.audit(user["id"], "password.changed", "user", str(user["id"]))
        self.send_json({"ok": True})


def main() -> None:
    with database():
        pass
    with sqlite3.connect(DB_PATH, timeout=15) as db:
        db.execute("PRAGMA journal_mode = WAL")
    server = ThreadingHTTPServer((HOST, PORT), AirSpaceHandler)
    actual_port = server.server_address[1]
    print(f"Air Space est lancé sur http://{HOST}:{actual_port}")
    print(f"Site public : http://127.0.0.1:{actual_port}/ · Espace équipe : http://127.0.0.1:{actual_port}/admin")
    print("Données locales dans air_space.sqlite3. Ctrl+C arrête le serveur.")
    if OPEN_BROWSER:
        webbrowser.open(f"http://127.0.0.1:{actual_port}/admin")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur Air Space arrêté.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
