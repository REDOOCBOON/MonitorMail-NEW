from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from datetime import datetime, timedelta, timezone
import psycopg2
import pandas as pd
import pdfplumber
import re
from io import StringIO, BytesIO
import smtplib
import socket
import json
from functools import wraps
import os
import csv
import secrets
import hmac
import base64
import urllib.parse
import hashlib
import html

import threading
import time
import uuid
import imaplib
import email
from email.header import decode_header
from email_util import EmailSender, GmailApiSender, GmailAuthError, http_json, GOOGLE_TOKEN_URL
import logging
from dotenv import load_dotenv

# Load backend/.env regardless of the directory the server is started from
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

# --- Logging Configuration ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# --- Configuration ---
def _fail_startup(message):
    print(f"\n❌ MonitorMail cannot start: {message}\n")
    raise SystemExit(1)


# The key that signs login sessions. Anyone who knows it can forge an admin login, so it must be long and secret.
SECRET_KEY = os.environ.get('SECRET_KEY', '')
if len(SECRET_KEY) < 32:
    _fail_startup('SECRET_KEY in backend/.env is missing or shorter than 32 characters. '
                  'Generate one with:  python3 -c "import secrets; print(secrets.token_urlsafe(48))"')

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    _fail_startup('DATABASE_URL is not set in backend/.env.')
DB_CONFIG = DATABASE_URL

# Only needed when the frontend is served from a different origin than the API (the dev server uses a proxy).
FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', 'http://localhost:3000')

# Behind a reverse proxy (nginx, Render...) set TRUST_PROXY=true so the real client IP is used for rate limits.
TRUST_PROXY = os.environ.get('TRUST_PROXY', 'false').lower() in ('1', 'true', 'yes')
# Set COOKIE_SECURE=true when the site is served over HTTPS.
COOKIE_SECURE = os.environ.get('COOKIE_SECURE', 'false').lower() in ('1', 'true', 'yes')

SESSION_COOKIE = 'mm_session'
SESSION_HOURS = 12
CSRF_HEADER = 'X-Requested-With'
CSRF_HEADER_VALUE = 'MonitorMail'
MAX_UPLOAD_MB = 100  # the attendance PDF embeds student photos and can be ~50 MB

# Teacher self-registration: only this email domain may apply, and an admin must approve.
ALLOWED_TEACHER_DOMAIN = os.environ.get('ALLOWED_TEACHER_DOMAIN', 'srmist.edu.in').lower().lstrip('@')
OTP_EXPIRY_MINUTES = 10
OTP_RESEND_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS_PER_HOUR = 5

# System mailbox used for OTP / approval emails (a Gmail account + its app password).
SYSTEM_EMAIL = os.environ.get('SYSTEM_EMAIL', '').strip()
SYSTEM_EMAIL_APP_PASSWORD = os.environ.get('SYSTEM_EMAIL_APP_PASSWORD', '').replace(' ', '')
# When no system mailbox is configured, print OTPs to the backend console (local testing only).
OTP_CONSOLE_FALLBACK = os.environ.get('OTP_CONSOLE_FALLBACK', 'false').lower() in ('1', 'true', 'yes')

ATTENDANCE_THRESHOLD = 75

# Passwords that are refused at registration/reset and locked at sign-in
COMMON_PASSWORDS = {
    'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'admin123', 'admin@123',
    'welcome123', 'iloveyou', 'abc12345', 'letmein123', 'srmist123', 'teacher123', 'monitormail', 'changeme',
}


def password_problem(password, email=''):
    """Return a reason the password is too weak, or None if it is acceptable."""
    if len(password) < 8:
        return 'Password must be at least 8 characters long.'
    if len(password) > 128:
        return 'Password must be at most 128 characters long.'
    if not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
        return 'Password must contain at least one letter and one number.'
    local_part = email.split('@')[0].lower()
    if password.lower() in COMMON_PASSWORDS or (len(local_part) >= 4 and local_part in password.lower()):
        return 'This password is too easy to guess. Please choose another one.'
    return None


# --- App Initialization ---
app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_MB * 1024 * 1024
app.config['JSON_SORT_KEYS'] = False
if TRUST_PROXY:
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# Cookies are only sent back to the listed origin; never '*' with credentials.
CORS(app, origins=[o.strip() for o in FRONTEND_ORIGIN.split(',') if o.strip() and o.strip() != '*'],
     supports_credentials=True, allow_headers=['Content-Type', CSRF_HEADER])

logger = logging.getLogger('monitormail')


# --- Rate limiting (in-memory, keyed by IP / account) ---
_rate_buckets = {}
_rate_lock = threading.Lock()


def client_ip():
    # request.remote_addr only; X-Forwarded-For is trusted solely via ProxyFix when TRUST_PROXY is on
    return request.remote_addr or 'unknown'


def _rate_count(key, window):
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_buckets.get(key, []) if now - t < window]
        _rate_buckets[key] = hits
        return len(hits)


def _rate_record(key):
    with _rate_lock:
        _rate_buckets.setdefault(key, []).append(time.time())
        if len(_rate_buckets) > 50000:  # keep memory bounded
            for k in list(_rate_buckets)[:10000]:
                _rate_buckets.pop(k, None)


def _throttled(key, limit, window):
    """Count this call against `key`; True if it went over the limit."""
    if _rate_count(key, window) >= limit:
        return True
    _rate_record(key)
    return False


def too_many_requests(message='Too many attempts. Please wait a few minutes and try again.'):
    return jsonify({'message': message}), 429


# --- Security headers & CSRF ---
APP_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
           "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
           "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")


@app.before_request
def csrf_protect():
    """
    State-changing API calls must carry a custom header. Browsers can't add it cross-site without a CORS
    preflight (which only the allowed origin passes), and the session cookie is SameSite=Strict as well.
    """
    if request.method in ('POST', 'PUT', 'PATCH', 'DELETE') and request.path.startswith('/api/'):
        if request.headers.get(CSRF_HEADER) != CSRF_HEADER_VALUE:
            return jsonify({'message': 'Request blocked.'}), 403
    return None


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()'
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    else:
        response.headers['Content-Security-Policy'] = APP_CSP
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains'
    response.headers.pop('Server', None)
    return response


def server_error(error, message='Something went wrong. Please try again.', status=500):
    """Log the real error on the server; send the browser only a generic message."""
    logger.exception(f"Server error: {error}")
    return jsonify({'message': message}), status


@app.errorhandler(413)
def file_too_large(_):
    return jsonify({'message': f'File is too large (limit {MAX_UPLOAD_MB} MB).'}), 413


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith('/api/'):
        return jsonify({'message': 'Not found.'}), 404
    return serve_frontend(request.path.lstrip('/'))


@app.errorhandler(405)
def method_not_allowed(_):
    return jsonify({'message': 'Method not allowed.'}), 405


@app.errorhandler(Exception)
def unhandled_error(error):
    from werkzeug.exceptions import HTTPException
    if isinstance(error, HTTPException):
        return jsonify({'message': error.description}), error.code
    return server_error(error)


# --- DB Connection Helper ---
def get_db_connection():
    conn = psycopg2.connect(DB_CONFIG)
    # Always look up tables in "public": pooled connections (e.g. Neon's -pooler host) can hand over a
    # session whose search_path another client changed
    with conn.cursor() as cursor:
        cursor.execute("SET search_path TO public")
    return conn

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE
);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor VARCHAR(100),
    action VARCHAR(60) NOT NULL,
    target VARCHAR(200),
    details TEXT,
    ip VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at);
CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers (email);

CREATE TABLE IF NOT EXISTS teacher_registrations (
    email VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    otp_hash VARCHAR(128) NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gmail_connections (
    teacher_id INTEGER PRIMARY KEY,  -- teachers.id (older databases have no primary key there, so no FK)
    google_email VARCHAR(100) NOT NULL,
    refresh_token_enc TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
    email VARCHAR(100) PRIMARY KEY,
    otp_hash VARCHAR(128) NOT NULL,
    otp_expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    "Reg.No" VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    section VARCHAR(10) NOT NULL DEFAULT '',
    department VARCHAR(10) NOT NULL DEFAULT '',
    phone_number VARCHAR(15),
    email VARCHAR(100),
    parent_mobile VARCHAR(15),
    parent_email VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_students_reg_no ON students ("Reg.No");

CREATE TABLE IF NOT EXISTS history (
    id SERIAL PRIMARY KEY,
    student_reg_no VARCHAR(20) NOT NULL,
    student_name VARCHAR(100),
    subject VARCHAR(255),
    body TEXT,
    recipients TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    teacher_email VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_history_sent_at ON history (sent_at);
CREATE INDEX IF NOT EXISTS idx_history_student_reg_no ON history (student_reg_no);

CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    body TEXT NOT NULL
);

"""

DEFAULT_TEMPLATE_NAME = 'Default Low Attendance Warning'
DEFAULT_TEMPLATE_BODY = """Dear [Student Name],

This is to inform you that your attendance is below the required 75% in the following subject(s):

[Subject List]

As per university regulations, students with less than 75% attendance may be debarred from the end-semester examinations. Please attend all classes regularly and meet your Faculty Advisor if you have any concerns.

This email is also being sent to your parent/guardian for their information.

Regards,
Faculty Advisor"""


def ensure_schema():
    """Create missing tables/columns so a fresh or older database works with this version."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SCHEMA_SQL)
        cursor.execute("SELECT COUNT(*) FROM templates")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO templates (name, body) VALUES (%s, %s)", (DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_BODY))
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print("Schema setup error:", e)


def ensure_admin_exists():
    """
    Keep ADMIN_EMAIL (backend/.env) as an approved admin. The account is only created when it doesn't exist
    and ADMIN_PASSWORD is strong; there are no built-in default credentials.
    """
    admin_email = os.environ.get('ADMIN_EMAIL', '').strip().lower()
    admin_password = os.environ.get('ADMIN_PASSWORD', '')
    admin_name = os.environ.get('ADMIN_NAME', 'Admin')
    if not admin_email:
        print("⚠️  ADMIN_EMAIL is not set in backend/.env - no admin account is managed automatically.")
        return
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM teachers WHERE LOWER(email) = %s", (admin_email,))
        if cursor.fetchall():
            cursor.execute("UPDATE teachers SET is_admin = TRUE, status = 'approved' WHERE LOWER(email) = %s", (admin_email,))
        elif password_problem(admin_password, admin_email):
            print(f"⚠️  Admin {admin_email} was not created: ADMIN_PASSWORD is missing or too weak.")
        else:
            cursor.execute(
                "INSERT INTO teachers (name, email, password_hash, is_admin, status) VALUES (%s,%s,%s,%s,'approved')",
                (admin_name, admin_email, generate_password_hash(admin_password, method='pbkdf2:sha256'), True)
            )
            print(f"Admin created: {admin_email}")
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print("Admin setup error:", e)


# --- System emails (OTP / approval notifications) ---
def send_system_email(to_email, subject, body_html):
    """
    Send OTP / approval emails from SYSTEM_EMAIL. Uses that account's connected Gmail (API) when available,
    otherwise SYSTEM_EMAIL_APP_PASSWORD over SMTP. Returns (success, message).
    """
    if not SYSTEM_EMAIL:
        return False, 'System email is not configured (set SYSTEM_EMAIL in backend/.env).'
    sender = None
    try:
        if gmail_api_configured():
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT id FROM teachers WHERE LOWER(email) = %s ORDER BY id LIMIT 1", (SYSTEM_EMAIL.lower(),))
                row = cursor.fetchone()
            finally:
                conn.close()
            connection = _gmail_connection(row[0]) if row else None
            if connection:
                sender = GmailApiSender(connection[0], connection[1], GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
        if sender is None:
            if not SYSTEM_EMAIL_APP_PASSWORD:
                return False, f'The system account ({SYSTEM_EMAIL}) has not connected Gmail yet.'
            sender = EmailSender(sender_email=SYSTEM_EMAIL, sender_password=SYSTEM_EMAIL_APP_PASSWORD, max_retries=2, timeout=15)
        sender.connect()
        return sender.send_email(to_email=to_email, subject=subject, body_html=body_html)
    except (smtplib.SMTPAuthenticationError, GmailAuthError):
        return False, 'The system email account could not sign in to Gmail.'
    except Exception as e:
        logger.exception(f'system email failed: {e}')
        return False, 'Could not send email.'
    finally:
        if sender:
            sender.logout()


def _hash_otp(email, otp):
    return hmac.new(app.config['SECRET_KEY'].encode(), f"{email}:{otp}".encode(), hashlib.sha256).hexdigest()


def _email_layout(title, inner_html):
    return f"""<html><body style="font-family: Arial, sans-serif; color: #1f2937;">
<div style="max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
<h2 style="color: #0e7490; margin-top: 0;">{title}</h2>{inner_html}
<p style="color: #6b7280; font-size: 12px; margin-top: 24px;">MonitorMail &middot; This is an automated message.</p>
</div></body></html>"""

# --- DB Helper for Analytics (Unchanged) ---
# --- Email Monitoring (IMAP keyword rules) ---
monitor_lock = threading.Lock()
monitors = {}  # monitor_id -> monitor config
monitor_matches = {}  # monitor_id -> list of match events


def _decode_header_value(value):
    if not value:
        return ''
    decoded_parts = decode_header(value)
    result = ''
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            try:
                result += part.decode(encoding or 'utf-8', errors='ignore')
            except Exception:
                result += part.decode('utf-8', errors='ignore')
        else:
            result += part
    return result


def _extract_email_snippet(msg):
    # Try to get a short snippet from the email body
    snippet = ''
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == 'text/plain' and not part.get('Content-Disposition'):
                try:
                    snippet = part.get_payload(decode=True).decode(errors='ignore')
                    break
                except Exception:
                    continue
    else:
        try:
            snippet = msg.get_payload(decode=True).decode(errors='ignore')
        except Exception:
            snippet = ''
    return (snippet or '').strip().replace('\r', '').replace('\n', ' ')[:250]


def _run_monitor_once(monitor):
    # Monitor structure: {id, name, imap_host, imap_port, username, password, folder, subject_contains, interval_seconds, last_checked, seen_uids}
    try:
        imap_host = monitor.get('imap_host')
        imap_port = int(monitor.get('imap_port', 993))
        username = monitor.get('username')
        password = monitor.get('password')
        folder = monitor.get('folder') or 'INBOX'
        subject_filter = (monitor.get('subject_contains') or '').strip().lower()

        if not imap_host or not username or not password or not subject_filter:
            return

        mail = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=30)
        mail.login(username, password)
        mail.select(folder)

        # Search for unseen messages
        res, data = mail.search(None, 'UNSEEN')
        if res != 'OK':
            mail.logout()
            return

        uids = data[0].split() if data and data[0] else []
        new_uids = []
        seen_uids = monitor.setdefault('seen_uids', set())
        for uid in uids:
            if uid in seen_uids:
                continue
            new_uids.append(uid)

        if not new_uids:
            mail.logout()
            return

        for uid in new_uids:
            res, msg_data = mail.fetch(uid, '(RFC822)')
            if res != 'OK' or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            try:
                msg = email.message_from_bytes(raw)
            except Exception:
                continue
            subj = _decode_header_value(msg.get('Subject'))
            sender = _decode_header_value(msg.get('From'))
            snippet = _extract_email_snippet(msg)
            match = False
            if subject_filter in (subj or '').lower() or subject_filter in (snippet or '').lower():
                match = True
            if match:
                event = {
                    'timestamp': datetime.now(timezone.utc).isoformat(),
                    'subject': subj,
                    'from': sender,
                    'snippet': snippet,
                    'uid': uid.decode() if isinstance(uid, bytes) else str(uid)
                }
                with monitor_lock:
                    matches = monitor_matches.setdefault(monitor['id'], [])
                    matches.append(event)
                    del matches[:-500]  # keep memory bounded
            seen_uids.add(uid)

        mail.logout()
    except Exception as e:
        # Log, but do not raise to keep the background thread running
        print(f"Monitor error (id={monitor.get('id')}): {e}")


def _monitor_loop():
    while True:
        now = time.time()
        with monitor_lock:
            monitors_list = list(monitors.values())
        for monitor in monitors_list:
            interval = int(monitor.get('interval_seconds', 60))
            last_checked = monitor.get('last_checked', 0)
            if now - last_checked >= interval:
                monitor['last_checked'] = now
                _run_monitor_once(monitor)
        time.sleep(5)


def _ensure_monitor_thread():
    if not hasattr(app, '_monitor_thread_started'):
        thread = threading.Thread(target=_monitor_loop, daemon=True)
        thread.start()
        app._monitor_thread_started = True

# --- Sessions (HttpOnly cookie) & authorization ---
# A pre-computed hash so sign-in takes the same time whether or not the email exists
_DUMMY_PASSWORD_HASH = generate_password_hash(secrets.token_urlsafe(16), method='pbkdf2:sha256')


def _issue_session(response, teacher_id, token_version):
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        'sub': str(teacher_id),
        'tv': token_version,
        'jti': secrets.token_urlsafe(12),
        'iat': now,
        'nbf': now,
        'exp': now + timedelta(hours=SESSION_HOURS),
    }, app.config['SECRET_KEY'], algorithm='HS256')
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True,
                        secure=COOKIE_SECURE, samesite='Strict', path='/')
    return response


def _clear_session(response):
    response.delete_cookie(SESSION_COOKIE, path='/', httponly=True, secure=COOKIE_SECURE, samesite='Strict')
    return response


def _load_session_user():
    """Validate the session cookie against the database. Returns a user dict or None."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        claims = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'],
                            options={'require': ['exp', 'iat', 'sub', 'tv']})
        teacher_id = int(claims['sub'])
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, name, is_admin, status, token_version FROM teachers WHERE id = %s", (teacher_id,))
        row = cursor.fetchone()
    finally:
        conn.close()
    # Deleted, rejected/pending, or signed out everywhere (password changed, role changed...) -> session is dead
    if not row or row[4] != 'approved' or row[5] != claims['tv']:
        return None
    return {'id': row[0], 'user': row[1], 'email': row[1], 'name': row[2], 'is_admin': bool(row[3])}


def _session_expired():
    response = jsonify({'message': 'Your session has expired. Please sign in again.', 'code': 'session_expired'})
    _clear_session(response)
    return response, 401


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _load_session_user()
        if not user:
            return _session_expired()
        g.current_user = user
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _load_session_user()
        if not user:
            return _session_expired()
        if not user['is_admin']:
            return jsonify({'message': 'Admin privileges required.'}), 403
        g.current_user = user
        return f(*args, **kwargs)
    return decorated


def _bump_token_version(cursor, teacher_id=None, email=None):
    """Sign a teacher out of every device (used after password/role changes)."""
    if teacher_id is not None:
        cursor.execute("UPDATE teachers SET token_version = token_version + 1 WHERE id = %s", (teacher_id,))
    else:
        cursor.execute("UPDATE teachers SET token_version = token_version + 1 WHERE LOWER(email) = %s", (email,))


# --- Audit log ---
def audit(action, target='', details='', actor=None):
    """Record a security-relevant event. Never raises."""
    try:
        if actor is None:
            actor = (g.get('current_user') or {}).get('user', '')
        conn = get_db_connection()
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO audit_log (actor, action, target, details, ip) VALUES (%s, %s, %s, %s, %s)",
                (str(actor)[:100], action[:60], str(target)[:200], str(details)[:1000], client_ip()[:64])
            )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"audit log failed: {e}")


# --- PDF Processing Logic ---
# The SRM "Faculty Advisor's Consolidated Academic Status" report is a table:
#   S.No | Photo - ID | Reg.No | Name | Slots A to G & X & O (theory) ... | LAB Slots ...
# Each subject cell holds "<course code>[(<slot>)]\n<percentage>".
REG_NO_PATTERN = re.compile(r'\bRA\d{13}\b')
COURSE_CELL_PATTERN = re.compile(r'(\d{2}[A-Z]{2,4}\d{3}[A-Z]?)\s*(\(([A-Z])\))?')
PERCENT_PATTERN = re.compile(r'(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)(?![\d.])')
CSV_COLUMNS = ['Reg.No', 'Name', 'Subject', 'Type', 'Percentage']


def _clean_cell(cell):
    return re.sub(r'\s+', ' ', str(cell or '')).strip()


def _subject_label(code, slot, is_lab):
    if is_lab:
        return f"{code} (Lab)"
    return f"{code}({slot})" if slot else code


def _parse_subject_cell(cell):
    """Return (code, slot, percentage) from a cell like '21CSC303J(B)\\n70.00', or None."""
    text = str(cell or '')
    course = COURSE_CELL_PATTERN.search(text)
    if not course:
        return None
    remainder = text[course.end():]
    pct = PERCENT_PATTERN.search(remainder)
    if not pct:
        return None
    value = float(pct.group(1))
    if not 0 <= value <= 100:
        return None
    return course.group(1), course.group(3), value


def _find_header(table):
    """Locate the header row. Returns (row_index, reg_col, name_col) or None."""
    for idx, row in enumerate(table[:5]):
        cells = [_clean_cell(c).lower() for c in row]
        reg_col = next((i for i, c in enumerate(cells) if 'reg' in c), None)
        if reg_col is None:
            continue
        name_col = next((i for i, c in enumerate(cells) if c.startswith('name')), None)
        return idx, reg_col, name_col
    return None


def _extract_table_students(table, layout, students):
    header = _find_header(table)
    if header:
        header_idx, reg_col, name_col = header
        layout.update(reg_col=reg_col, name_col=name_col)
        rows = table[header_idx + 1:]
    elif layout:
        rows = table  # continuation page without a header: reuse the last known layout
    else:
        return

    for row in rows:
        row_text = ' '.join(_clean_cell(c) for c in row)
        reg_match = REG_NO_PATTERN.search(row_text)
        if not reg_match:
            continue
        reg_no = reg_match.group(0)

        name_col = layout.get('name_col')
        name = _clean_cell(row[name_col]) if name_col is not None and name_col < len(row) else ''

        subjects = []
        first_subject_col = max(layout.get('reg_col') or 0, name_col or 0) + 1
        for col in range(first_subject_col, len(row)):
            parsed = _parse_subject_cell(row[col])
            if not parsed:
                continue
            code, slot, pct = parsed
            # Theory courses carry a slot letter, e.g. 21CSC303J(B); lab slots have none
            is_lab = not slot
            subjects.append({
                'Subject': _subject_label(code, slot, is_lab),
                'Type': 'Lab' if is_lab else 'Theory',
                'Percentage': pct,
            })

        if subjects:
            students[reg_no] = {'name': name.title() if name.isupper() else name, 'subjects': subjects}


def _extract_text_students(text, students):
    """
    Fallback for pages where table detection fails. In the text layer each student appears as
      <course codes line>  /  <S.No> <Reg.No> <Name>  /  <percentages line>
    (name fragments can spill onto neighbouring lines, so names here come from the DB instead).
    """
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        reg_match = REG_NO_PATTERN.search(line)
        if not reg_match or reg_match.group(0) in students:
            continue
        codes = []
        for j in (i - 1, i, i - 2):
            if 0 <= j < len(lines):
                codes = COURSE_CELL_PATTERN.findall(lines[j])
                if codes:
                    break
        pcts = []
        for j in (i + 1, i + 2):
            if j < len(lines) and not REG_NO_PATTERN.search(lines[j]):
                pcts = re.findall(r'\b\d{1,3}\.\d{2}\b', lines[j])
                if pcts:
                    break
        if not codes or len(codes) != len(pcts):
            continue
        subjects = []
        for (code, _, slot), pct in zip(codes, pcts):
            is_lab = not slot
            subjects.append({
                'Subject': _subject_label(code, slot, is_lab),
                'Type': 'Lab' if is_lab else 'Theory',
                'Percentage': float(pct),
            })
        students[reg_match.group(0)] = {'name': '', 'subjects': subjects}


def parse_attendance_pdf(pdf_file):
    """Parse the attendance PDF into {reg_no: {'name': str, 'subjects': [{Subject, Type, Percentage}]}}."""
    logger = logging.getLogger(__name__)
    students = {}
    layout = {}
    with pdfplumber.open(pdf_file) as pdf:
        logger.info(f"📄 Processing PDF with {len(pdf.pages)} pages")
        for page_idx, page in enumerate(pdf.pages):
            try:
                before = len(students)
                for table in page.extract_tables():
                    _extract_table_students(table, layout, students)
                # Catch any student on this page that the table pass missed
                page_regs = set(REG_NO_PATTERN.findall(page.extract_text() or ''))
                if page_regs - set(students):
                    _extract_text_students(page.extract_text() or '', students)
                logger.info(f"📖 Page {page_idx + 1}: {len(students) - before} students")
            except Exception as e:
                logger.warning(f"⚠️ Error processing page {page_idx + 1}: {e}")
    logger.info(f"✅ Extracted {len(students)} students, {sum(len(s['subjects']) for s in students.values())} subject records")
    return students


def students_to_csv_string(students):
    """Serialise parsed students to CSV text with columns Reg.No,Name,Subject,Type,Percentage."""
    csv_output = StringIO()
    writer = csv.writer(csv_output)
    writer.writerow(CSV_COLUMNS)
    for reg_no in sorted(students):
        record = students[reg_no]
        for s in record['subjects']:
            writer.writerow([reg_no, record['name'], s['Subject'], s['Type'], f"{s['Percentage']:.2f}"])
    return csv_output.getvalue()


# --- API Endpoints ---

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()[:100]
    password = str(data.get('password') or '')[:128]
    ip = client_ip()
    invalid = 'Invalid email or password.'

    # 20 attempts / 15 min per IP, 5 failed attempts / 15 min per account
    if _throttled(f'login-ip:{ip}', 20, 900) or _rate_count(f'login-fail:{email}', 900) >= 5:
        audit('login_blocked', email, 'rate limited', actor=email)
        return too_many_requests('Too many sign-in attempts. Please wait 15 minutes and try again.')
    if not email or not password:
        return jsonify({'message': invalid}), 401

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, email, password_hash, name, is_admin, status, token_version FROM teachers WHERE LOWER(email) = %s ORDER BY id",
            (email,)
        )
        teacher = cursor.fetchone()
        cursor.close()
        conn.close()
    except Exception as e:
        return server_error(e)

    # Always run one hash check so response time doesn't reveal whether the email exists
    password_ok = check_password_hash(teacher[2] if teacher else _DUMMY_PASSWORD_HASH, password)
    if not teacher or not password_ok:
        _rate_record(f'login-fail:{email}')
        audit('login_failed', email, actor=email)
        return jsonify({'message': invalid}), 401

    status = teacher[5] or 'approved'
    if status == 'pending':
        return jsonify({'message': 'Your account is waiting for admin approval. You will get an email once it is approved.'}), 403
    if status == 'rejected':
        return jsonify({'message': invalid}), 401
    if password.lower() in COMMON_PASSWORDS or len(password) < 8:
        audit('login_weak_password_blocked', email, actor=email)
        return jsonify({'message': 'This account uses a password that is too easy to guess, so sign-in is blocked. '
                                   'Use "Forgot password?" or ask the administrator to set a new one.'}), 403

    user = {'id': teacher[0], 'email': teacher[1], 'name': teacher[3], 'is_admin': bool(teacher[4])}
    audit('login_success', email, actor=email)
    return _issue_session(jsonify({'user': user}), teacher[0], teacher[6])


@app.route('/api/auth/me', methods=['GET'])
@token_required
def current_user():
    u = g.current_user
    return jsonify({'user': {'id': u['id'], 'email': u['email'], 'name': u['name'], 'is_admin': u['is_admin']}})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    return _clear_session(jsonify({'message': 'Signed out.'}))


# --- Teacher self-registration (email OTP + admin approval) ---
GENERIC_REGISTER_MESSAGE = 'If this email can be registered, we sent a 6-digit code to it. It expires in {} minutes.'


@app.route('/api/auth/register/request-otp', methods=['POST'])
def register_request_otp():
    data = request.get_json(silent=True) or {}
    name = re.sub(r'\s+', ' ', str(data.get('name') or '')).strip()[:100]
    email = str(data.get('email') or '').strip().lower()[:100]
    password = str(data.get('password') or '')

    if not name or not email or not password:
        return jsonify({'message': 'Name, email and password are required.'}), 400
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,99}", name):
        return jsonify({'message': 'Please enter your name using letters only.'}), 400
    if not re.fullmatch(r'[a-z0-9._%+-]+@' + re.escape(ALLOWED_TEACHER_DOMAIN), email):
        return jsonify({'message': f'Please use your official @{ALLOWED_TEACHER_DOMAIN} email address.'}), 400
    problem = password_problem(password, email)
    if problem:
        return jsonify({'message': problem}), 400
    if _throttled(f'register-ip:{client_ip()}', 10, 3600) or _throttled(f'otp-send:{email}', OTP_MAX_SENDS_PER_HOUR, 3600):
        return too_many_requests('Too many codes requested. Please try again in an hour.')

    generic = {'message': GENERIC_REGISTER_MESSAGE.format(OTP_EXPIRY_MINUTES)}
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM teachers WHERE LOWER(email) = %s", (email,))
        if cursor.fetchone():
            conn.close()
            # Don't reveal that the account exists; tell the mailbox owner instead
            send_system_email(email, 'MonitorMail registration attempt', _email_layout('You already have an account', """
<p>Someone (hopefully you) tried to register a new MonitorMail account with this email address.</p>
<p>You already have an account. If you forgot your password, use <strong>Forgot password?</strong> on the sign-in page.
If your account is still waiting for approval, you will get an email once the administrator approves it.</p>"""))
            return jsonify(generic)

        cursor.execute("SELECT last_sent_at FROM teacher_registrations WHERE email = %s", (email,))
        pending = cursor.fetchone()
        now = datetime.now(timezone.utc)
        if pending and (now - pending[0]).total_seconds() < OTP_RESEND_SECONDS:
            wait = OTP_RESEND_SECONDS - int((now - pending[0]).total_seconds())
            conn.close()
            return jsonify({'message': f'Please wait {wait} seconds before requesting a new code.'}), 429

        otp = f"{secrets.randbelow(1000000):06d}"
        cursor.execute(
            """INSERT INTO teacher_registrations (email, name, password_hash, otp_hash, otp_expires_at, attempts, last_sent_at)
               VALUES (%s, %s, %s, %s, %s, 0, %s)
               ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
                   otp_hash = EXCLUDED.otp_hash, otp_expires_at = EXCLUDED.otp_expires_at, attempts = 0,
                   last_sent_at = EXCLUDED.last_sent_at""",
            (email, name, generate_password_hash(password, method='pbkdf2:sha256'), _hash_otp(email, otp),
             now + timedelta(minutes=OTP_EXPIRY_MINUTES), now)
        )

        body = _email_layout('Verify your email', f"""
<p>Hello {html.escape(name)},</p>
<p>Use the code below to verify your email and complete your MonitorMail registration:</p>
<p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">{otp}</p>
<p>This code expires in {OTP_EXPIRY_MINUTES} minutes. Never share it with anyone. If you did not request this, you can ignore this email.</p>""")
        sent, msg = send_system_email(email, 'Your MonitorMail verification code', body)
        if not sent:
            if OTP_CONSOLE_FALLBACK:
                logger.warning(f"⚠️ {msg} OTP for {email}: {otp}")
            else:
                conn.rollback()
                conn.close()
                logger.error(f"OTP email failed: {msg}")
                return jsonify({'message': 'We could not send the verification email right now. Please try again later.'}), 503

        conn.commit()
        conn.close()
        return jsonify(generic)
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/auth/register/verify-otp', methods=['POST'])
def register_verify_otp():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()[:100]
    otp = re.sub(r'\D', '', str(data.get('otp') or ''))[:6]
    if not email or len(otp) != 6:
        return jsonify({'message': 'Please enter the 6-digit code from your email.'}), 400
    if _throttled(f'verify-ip:{client_ip()}', 30, 3600):
        return too_many_requests()

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, password_hash, otp_hash, otp_expires_at, attempts FROM teacher_registrations WHERE email = %s",
            (email,)
        )
        reg = cursor.fetchone()
        if not reg:
            conn.close()
            return jsonify({'message': 'No pending registration for this email. Please register again.'}), 404
        name, password_hash, otp_hash, expires_at, attempts = reg

        if attempts >= OTP_MAX_ATTEMPTS:
            conn.close()
            return jsonify({'message': 'Too many wrong attempts. Please request a new code.'}), 429
        if datetime.now(timezone.utc) > expires_at:
            conn.close()
            return jsonify({'message': 'This code has expired. Please request a new one.'}), 400
        if not hmac.compare_digest(otp_hash, _hash_otp(email, otp)):
            cursor.execute("UPDATE teacher_registrations SET attempts = attempts + 1 WHERE email = %s", (email,))
            conn.commit()
            conn.close()
            left = OTP_MAX_ATTEMPTS - attempts - 1
            return jsonify({'message': f'Incorrect code. {left} attempt(s) left.'}), 400

        cursor.execute("SELECT 1 FROM teachers WHERE LOWER(email) = %s", (email,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO teachers (name, email, password_hash, is_admin, status) VALUES (%s, %s, %s, FALSE, 'pending')",
                (name, email, password_hash)
            )
        cursor.execute("DELETE FROM teacher_registrations WHERE email = %s", (email,))
        conn.commit()
        conn.close()

        audit('registration_verified', email, actor=email)
        # Let the admin know someone is waiting (best effort)
        admin_email = os.environ.get('ADMIN_EMAIL', '').strip()
        if admin_email:
            send_system_email(admin_email, 'New teacher registration waiting for approval', _email_layout('New registration awaiting approval', f"""
<p><strong>{html.escape(name)}</strong> ({html.escape(email)}) has verified their email and is waiting for approval.</p>
<p>Open MonitorMail &rarr; <strong>Approvals</strong> tab to approve or reject.</p>"""))

        return jsonify({'message': 'Email verified! Your account is now waiting for admin approval. You will get an email once approved.'})
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


# --- Password reset (email OTP) and change password ---
GENERIC_RESET_MESSAGE = 'If an approved account exists for this email, we sent a 6-digit reset code to it.'


@app.route('/api/auth/password/request-reset', methods=['POST'])
def request_password_reset():
    email = str((request.get_json(silent=True) or {}).get('email') or '').strip().lower()[:100]
    if not email:
        return jsonify({'message': 'Please enter your email.'}), 400
    if _throttled(f'reset-ip:{client_ip()}', 10, 3600) or _throttled(f'otp-send:{email}', OTP_MAX_SENDS_PER_HOUR, 3600):
        return too_many_requests('Too many codes requested. Please try again in an hour.')

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM teachers WHERE LOWER(email) = %s AND status = 'approved' ORDER BY id", (email,))
        teacher = cursor.fetchone()
        if not teacher:
            conn.close()
            # Same answer whether or not the account exists, so emails can't be probed
            return jsonify({'message': GENERIC_RESET_MESSAGE})

        now = datetime.now(timezone.utc)
        cursor.execute("SELECT last_sent_at FROM password_resets WHERE email = %s", (email,))
        pending = cursor.fetchone()
        if pending and (now - pending[0]).total_seconds() < OTP_RESEND_SECONDS:
            wait = OTP_RESEND_SECONDS - int((now - pending[0]).total_seconds())
            conn.close()
            return jsonify({'message': f'Please wait {wait} seconds before requesting a new code.'}), 429

        otp = f"{secrets.randbelow(1000000):06d}"
        cursor.execute(
            """INSERT INTO password_resets (email, otp_hash, otp_expires_at, attempts, last_sent_at) VALUES (%s, %s, %s, 0, %s)
               ON CONFLICT (email) DO UPDATE SET otp_hash = EXCLUDED.otp_hash, otp_expires_at = EXCLUDED.otp_expires_at,
                   attempts = 0, last_sent_at = EXCLUDED.last_sent_at""",
            (email, _hash_otp('reset:' + email, otp), now + timedelta(minutes=OTP_EXPIRY_MINUTES), now)
        )
        body = _email_layout('Reset your password', f"""
<p>Hello {html.escape(teacher[0])},</p>
<p>Use this code to reset your MonitorMail password:</p>
<p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">{otp}</p>
<p>This code expires in {OTP_EXPIRY_MINUTES} minutes. If you did not ask for a reset, you can ignore this email; your password stays the same.</p>""")
        sent, msg = send_system_email(email, 'Your MonitorMail password reset code', body)
        if not sent:
            if OTP_CONSOLE_FALLBACK:
                logging.getLogger(__name__).warning(f"⚠️ {msg} Reset OTP for {email}: {otp}")
            else:
                conn.rollback(); conn.close()
                logger.error(f"reset email failed: {msg}")
                return jsonify({'message': 'We could not send the reset email right now. Please try again later.'}), 503
        conn.commit()
        conn.close()
        return jsonify({'message': GENERIC_RESET_MESSAGE})
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/auth/password/reset', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()[:100]
    otp = re.sub(r'\D', '', str(data.get('otp') or ''))[:6]
    new_password = str(data.get('new_password') or '')
    if not email or len(otp) != 6:
        return jsonify({'message': 'Please enter the 6-digit code from your email.'}), 400
    problem = password_problem(new_password, email)
    if problem:
        return jsonify({'message': problem}), 400
    if _throttled(f'verify-ip:{client_ip()}', 30, 3600):
        return too_many_requests()

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT otp_hash, otp_expires_at, attempts FROM password_resets WHERE email = %s", (email,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({'message': 'No reset was requested for this email, or the code was already used.'}), 404
        otp_hash, expires_at, attempts = row
        if attempts >= OTP_MAX_ATTEMPTS:
            conn.close()
            return jsonify({'message': 'Too many wrong attempts. Please request a new code.'}), 429
        if datetime.now(timezone.utc) > expires_at:
            conn.close()
            return jsonify({'message': 'This code has expired. Please request a new one.'}), 400
        if not hmac.compare_digest(otp_hash, _hash_otp('reset:' + email, otp)):
            cursor.execute("UPDATE password_resets SET attempts = attempts + 1 WHERE email = %s", (email,))
            conn.commit(); conn.close()
            return jsonify({'message': f'Incorrect code. {OTP_MAX_ATTEMPTS - attempts - 1} attempt(s) left.'}), 400

        cursor.execute("UPDATE teachers SET password_hash = %s WHERE LOWER(email) = %s",
                       (generate_password_hash(new_password, method='pbkdf2:sha256'), email))
        _bump_token_version(cursor, email=email)  # sign out every existing session
        cursor.execute("DELETE FROM password_resets WHERE email = %s", (email,))
        conn.commit()
        conn.close()
        audit('password_reset', email, actor=email)
        return jsonify({'message': 'Password updated. You can now sign in with your new password.'})
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/auth/change-password', methods=['POST'])
@token_required
def change_password():
    data = request.get_json(silent=True) or {}
    current_password = str(data.get('current_password') or '')
    new_password = str(data.get('new_password') or '')
    problem = password_problem(new_password, g.current_user['email'])
    if problem:
        return jsonify({'message': problem}), 400
    if _throttled(f'change-pw:{g.current_user["id"]}', 10, 900):
        return too_many_requests()

    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash FROM teachers WHERE id = %s", (g.current_user['id'],))
        row = cursor.fetchone()
        if not row or not check_password_hash(row[0], current_password):
            conn.close()
            return jsonify({'message': 'Your current password is incorrect.'}), 400
        cursor.execute("UPDATE teachers SET password_hash = %s, token_version = token_version + 1 WHERE id = %s RETURNING token_version",
                       (generate_password_hash(new_password, method='pbkdf2:sha256'), g.current_user['id']))
        new_version = cursor.fetchone()[0]
        conn.commit()
        conn.close()
        audit('password_changed', g.current_user['email'])
        # Other devices are signed out; this one gets a fresh session
        return _issue_session(jsonify({'message': 'Password changed. Other devices have been signed out.'}), g.current_user['id'], new_version)
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/upload-pdf', methods=['POST'])
@token_required
def upload_pdf():
    file = request.files.get('file')
    if not file: return jsonify({'message': 'Please choose a PDF file.'}), 400
    # Check the actual file signature, not just the extension
    if file.stream.read(5) != b'%PDF-':
        return jsonify({'message': 'This file is not a PDF.'}), 400
    file.stream.seek(0)
    try:
        students = parse_attendance_pdf(file)
        if not students:
            return jsonify({'error': 'No student attendance rows were found in this PDF. Please upload the "Consolidated Academic Status" report.'}), 422
        csv_data = students_to_csv_string(students)
        low_students = sum(1 for s in students.values() if any(x['Percentage'] < ATTENDANCE_THRESHOLD for x in s['subjects']))
        return jsonify({
            'csv_data': csv_data,
            'summary': {
                'total_students': len(students),
                'total_records': sum(len(s['subjects']) for s in students.values()),
                'low_attendance_students': low_students,
            }
        })
    except Exception as e:
        return server_error(e)


def _read_attendance_csv(csv_data):
    df = pd.read_csv(StringIO(csv_data), dtype={'Reg.No': str, 'Name': str, 'Subject': str, 'Type': str})
    df['Percentage'] = pd.to_numeric(df['Percentage'], errors='coerce')
    if 'Name' not in df.columns:
        df['Name'] = ''
    if 'Type' not in df.columns:
        df['Type'] = ''
    df[['Name', 'Type']] = df[['Name', 'Type']].fillna('')
    return df


@app.route('/api/sort-attendance', methods=['POST'])
@token_required
def sort_attendance():
    """
    Keep only subjects below the attendance threshold (75%) for every student who has at least one.
    """
    csv_data = request.get_json().get('csv_data', '')
    logger = logging.getLogger(__name__)

    try:
        df = _read_attendance_csv(csv_data)
        logger.info(f"📊 Processing {len(df)} records from {df['Reg.No'].nunique()} unique students")

        low_attendance_df = df[df['Percentage'] < ATTENDANCE_THRESHOLD].copy()
        low_attendance_df = low_attendance_df.sort_values(['Reg.No', 'Percentage'], ascending=[True, True])
        students_with_low_attendance = low_attendance_df['Reg.No'].unique().tolist()
        logger.info(f"🔴 {len(students_with_low_attendance)} students have at least 1 subject below {ATTENDANCE_THRESHOLD}%")

        csv_output = low_attendance_df[CSV_COLUMNS].to_csv(index=False)

        summary = {
            'total_students_with_low_attendance': len(students_with_low_attendance),
            'total_low_attendance_records': len(low_attendance_df),
            'average_low_attendance': float(low_attendance_df['Percentage'].mean()) if len(low_attendance_df) else 0.0,
            'critical_students': int(low_attendance_df.groupby('Reg.No')['Percentage'].min().lt(50).sum()) if len(low_attendance_df) else 0
        }
        return jsonify({'sorted_csv_data': csv_output, 'summary': summary})

    except Exception as e:
        logger.error(f"❌ Failed to sort data: {e}")
        return server_error(e)

@app.route('/api/fetch-details', methods=['POST'])
@token_required
def fetch_details():
    """
    Group the attendance CSV by student and attach student/parent emails from the database.
    Each record's `subjects` are the subjects that go into the email's [Subject List].
    """
    sorted_csv = request.get_json().get('sorted_csv_data', '')
    conn = None
    logger = logging.getLogger(__name__)

    try:
        df = _read_attendance_csv(sorted_csv)
        logger.info(f"📋 Fetching details for {len(df)} records")

        reg_nos = df['Reg.No'].dropna().unique().tolist()
        if not reg_nos:
            return jsonify([])

        conn = get_db_connection()
        cursor = conn.cursor()
        query = 'SELECT "Reg.No", name, email, parent_email, id FROM students WHERE "Reg.No" IN %s ORDER BY id'
        cursor.execute(query, (tuple(reg_nos),))
        student_details = cursor.fetchall()
        cursor.close()
        conn.close()
        conn = None

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT student_reg_no, MAX(sent_at), COUNT(*) FROM history WHERE student_reg_no IN %s GROUP BY student_reg_no", (tuple(reg_nos),))
        notified_map = {r[0]: {'last_notified_at': r[1].isoformat() if r[1] else None, 'times_notified': r[2]} for r in cursor.fetchall()}
        cursor.close()
        conn.close()
        conn = None

        details_map = {}
        for row in student_details:
            details_map.setdefault(row[0], {'name': row[1], 'student_email': row[2] or '', 'parent_email': row[3] or '', 'id': row[4]})
        logger.info(f"✅ Found {len(details_map)} of {len(reg_nos)} students in database")

        merged_data = []
        for reg_no, group in df.groupby('Reg.No', sort=True):
            db_details = details_map.get(reg_no, {})
            subjects = [
                {'Subject': r['Subject'], 'Type': r['Type'], 'Percentage': round(float(r['Percentage']), 2)}
                for _, r in group.sort_values('Percentage').iterrows() if pd.notna(r['Percentage'])
            ]
            low_subjects = [s for s in subjects if s['Percentage'] < ATTENDANCE_THRESHOLD]
            pdf_name = next((n for n in group['Name'] if n), '')
            merged_data.append({
                'reg_no': reg_no,
                'id': db_details.get('id'),
                'name': db_details.get('name') or pdf_name,
                'student_email': db_details.get('student_email', ''),
                'parent_email': db_details.get('parent_email', ''),
                'subjects': subjects,
                'low_attendance_subjects': low_subjects,
                'lowest_percentage': min((s['Percentage'] for s in subjects), default=None),
                'last_notified_at': notified_map.get(reg_no, {}).get('last_notified_at'),
                'times_notified': notified_map.get(reg_no, {}).get('times_notified', 0),
                'missing': not bool(db_details)
            })

        # Students not in the database first (they need attention), then by registration number
        merged_data.sort(key=lambda x: (not x['missing'], x['reg_no']))
        logger.info(f"📊 Returning {len(merged_data)} student records")
        return jsonify(merged_data)

    except Exception as e:
        logger.error(f"❌ Error in fetch_details: {e}")
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return server_error(e)

def _clean_email(email_str):
    """Return a trimmed email address, or None if it doesn't look valid."""
    if not email_str or not isinstance(email_str, str):
        return None
    email_str = email_str.strip()
    if re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email_str):
        return email_str
    return None


def _text_to_html(text):
    """Teacher-written plain text -> safe HTML (escape, keep line breaks)."""
    return html.escape(text or '').replace('\n', '<br>')


def _connect_teacher_gmail(teacher_email, gmail_app_password):
    """
    Log in to Gmail SMTP as the teacher. Returns (email_sender, None) or (None, error_message).
    """
    logger = logging.getLogger(__name__)
    if not gmail_app_password:
        return None, 'Gmail app password is required. Please enter your 16-character app password.'
    email_sender = EmailSender(sender_email=teacher_email, sender_password=gmail_app_password, max_retries=2, timeout=15)
    try:
        email_sender.connect()
        logger.info("✅ Gmail SMTP connection successful")
        return email_sender, None
    except smtplib.SMTPAuthenticationError:
        return None, (f'Google rejected the app password for {teacher_email}. Make sure 2-Step Verification is on '
                      f'and you generated the app password while signed in as {teacher_email}.')
    except (socket.timeout, socket.gaierror, ConnectionError, OSError):
        return None, 'Network error: unable to reach Gmail. Check your internet connection.'
    except Exception as e:
        logger.exception(f'gmail connect failed: {e}')
        return None, 'Could not connect to Gmail. Please try again.'


# --- Gmail connection (Google OAuth, send-only permission) ---
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()
PUBLIC_URL = next((o.strip().rstrip('/') for o in FRONTEND_ORIGIN.split(',') if o.strip() and o.strip() != '*'), 'http://localhost:3000')
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', f'{PUBLIC_URL}/api/google/callback')
GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
GMAIL_SCOPES = f'openid email {GMAIL_SEND_SCOPE}'

_oauth_nonces = {}  # nonce -> expiry (one-time use)


def gmail_api_configured():
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def _token_cipher():
    # Refresh tokens are encrypted at rest with a key derived from SECRET_KEY
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b'monitormail', info=b'gmail-refresh-token').derive(SECRET_KEY.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def _gmail_connection(teacher_id):
    """Returns (google_email, refresh_token) or None."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT google_email, refresh_token_enc FROM gmail_connections WHERE teacher_id = %s", (teacher_id,))
        row = cursor.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    try:
        return row[0], _token_cipher().decrypt(row[1].encode()).decode()
    except Exception:
        logger.warning(f"Could not decrypt Gmail token for teacher {teacher_id} (SECRET_KEY changed?)")
        return None


def _delete_gmail_connection(teacher_id):
    conn = get_db_connection()
    with conn.cursor() as cursor:
        cursor.execute("DELETE FROM gmail_connections WHERE teacher_id = %s", (teacher_id,))
    conn.commit()
    conn.close()


def open_email_sender(teacher_id, teacher_email, gmail_app_password=''):
    """
    Pick how to send for this teacher: their connected Gmail (API over HTTPS) first, else an app password (SMTP).
    Returns (sender, None, None) or (None, error_message, http_status).
    """
    if gmail_api_configured():
        connection = _gmail_connection(teacher_id)
        if connection:
            sender = GmailApiSender(connection[0], connection[1], GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
            try:
                sender.connect()
                return sender, None, None
            except GmailAuthError:
                _delete_gmail_connection(teacher_id)
                return None, 'Your Gmail connection has expired or was removed. Please click "Connect Gmail" again.', 400
            except Exception as e:
                logger.warning(f"Gmail API token refresh failed: {e}")
                return None, 'Could not reach Gmail. Please try again in a moment.', 502
        if not gmail_app_password:
            return None, 'Connect your Gmail account first (the "Connect Gmail" button).', 400
    email_sender, error = _connect_teacher_gmail(teacher_email, gmail_app_password)
    if error:
        return None, error, 400 if 'app password' in error else 502
    return email_sender, None, None


@app.route('/api/google/status', methods=['GET'])
@token_required
def gmail_status():
    connection = _gmail_connection(g.current_user['id']) if gmail_api_configured() else None
    return jsonify({'configured': gmail_api_configured(), 'connected': bool(connection),
                    'google_email': connection[0] if connection else None})


@app.route('/api/google/connect', methods=['POST'])
@token_required
def gmail_connect():
    if not gmail_api_configured():
        return jsonify({'message': 'Gmail connection is not set up on this server.'}), 400
    if _throttled(f'gmail-connect:{g.current_user["id"]}', 10, 600):
        return too_many_requests()
    now = time.time()
    for n, exp in list(_oauth_nonces.items()):
        if exp < now:
            _oauth_nonces.pop(n, None)
    nonce = secrets.token_urlsafe(24)
    _oauth_nonces[nonce] = now + 600
    state = jwt.encode({'sub': str(g.current_user['id']), 'purpose': 'gmail-connect', 'nonce': nonce,
                        'exp': datetime.now(timezone.utc) + timedelta(minutes=10)}, app.config['SECRET_KEY'], algorithm='HS256')
    params = {
        'client_id': GOOGLE_CLIENT_ID, 'redirect_uri': GOOGLE_REDIRECT_URI, 'response_type': 'code',
        'scope': GMAIL_SCOPES, 'access_type': 'offline', 'prompt': 'consent', 'include_granted_scopes': 'true',
        'login_hint': g.current_user['email'], 'state': state,
    }
    return jsonify({'url': f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"})


def _oauth_done(status, reason=''):
    """Small page that sends the browser back into the app (a same-site navigation, so the session cookie is sent)."""
    target = f"/?gmail={status}" + (f"&reason={urllib.parse.quote(reason)}" if reason else '')
    body = f'<!doctype html><meta http-equiv="refresh" content="0;url={html.escape(target)}"><title>MonitorMail</title>Returning to MonitorMail…'
    return app.response_class(body, mimetype='text/html')


@app.route('/api/google/callback', methods=['GET'])
def gmail_callback():
    if request.args.get('error'):
        return _oauth_done('error', 'Gmail permission was not granted.')
    try:
        claims = jwt.decode(request.args.get('state', ''), app.config['SECRET_KEY'], algorithms=['HS256'], options={'require': ['exp', 'sub']})
        if claims.get('purpose') != 'gmail-connect' or _oauth_nonces.pop(claims.get('nonce'), 0) < time.time():
            raise ValueError('bad state')
        teacher_id = int(claims['sub'])
    except Exception:
        return _oauth_done('error', 'This link has expired. Please click "Connect Gmail" again.')

    status, tokens = http_json(GOOGLE_TOKEN_URL, form={
        'code': request.args.get('code', ''), 'client_id': GOOGLE_CLIENT_ID, 'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri': GOOGLE_REDIRECT_URI, 'grant_type': 'authorization_code',
    })
    if status != 200 or not tokens.get('access_token'):
        logger.warning(f"Google code exchange failed: {status} {tokens.get('error')}")
        return _oauth_done('error', 'Google did not accept the sign-in. Please try again.')
    if GMAIL_SEND_SCOPE not in (tokens.get('scope') or '').split():
        return _oauth_done('error', 'Please tick "Send email on your behalf" on the Google screen.')
    if not tokens.get('refresh_token'):
        return _oauth_done('error', 'Google did not return a long-term permission. Please try again.')

    _, info = http_json(GOOGLE_USERINFO_URL, token=tokens['access_token'], method='GET')
    google_email = str(info.get('email') or '').lower()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT email FROM teachers WHERE id = %s AND status = 'approved'", (teacher_id,))
        row = cursor.fetchone()
        if not row:
            return _oauth_done('error', 'Your account is not active.')
        if not info.get('email_verified') or google_email != row[0].lower():
            http_json(GOOGLE_REVOKE_URL, form={'token': tokens['refresh_token']})
            return _oauth_done('error', f'Please choose the Google account {row[0]} (you picked {google_email or "another account"}).')
        cursor.execute(
            """INSERT INTO gmail_connections (teacher_id, google_email, refresh_token_enc) VALUES (%s, %s, %s)
               ON CONFLICT (teacher_id) DO UPDATE SET google_email = EXCLUDED.google_email,
                   refresh_token_enc = EXCLUDED.refresh_token_enc, connected_at = NOW()""",
            (teacher_id, google_email, _token_cipher().encrypt(tokens['refresh_token'].encode()).decode())
        )
        conn.commit()
    finally:
        conn.close()
    audit('gmail_connected', google_email, actor=google_email)
    return _oauth_done('connected')


@app.route('/api/google/disconnect', methods=['POST'])
@token_required
def gmail_disconnect():
    connection = _gmail_connection(g.current_user['id'])
    if connection:
        http_json(GOOGLE_REVOKE_URL, form={'token': connection[1]})  # best effort
    _delete_gmail_connection(g.current_user['id'])
    audit('gmail_disconnected', g.current_user['email'])
    return jsonify({'message': 'Gmail disconnected.'})


def _log_history(conn, reg_no, name, subject, body, recipients, teacher_email):
    with conn.cursor() as cursor:
        cursor.execute(
            "INSERT INTO history (student_reg_no, student_name, subject, body, recipients, teacher_email) VALUES (%s, %s, %s, %s, %s, %s)",
            (reg_no, name, subject, body, ", ".join(recipients), teacher_email)
        )
    conn.commit()


@app.route('/api/send-emails', methods=['POST'])
@token_required
def send_emails_endpoint():
    """Send each student (CC parent) their attendance email from the teacher's Gmail account."""
    logger = logging.getLogger(__name__)
    logger.info("API HIT: send_emails_endpoint")

    conn = None
    email_sender = None
    try:
        # Handle both JSON and form data
        attachment = None
        if request.is_json:
            data = request.get_json()
        else:
            email_payload_str = request.form.get('email_payload')
            if not email_payload_str:
                return jsonify({'success': False, 'error': 'email_payload missing'}), 400
            try:
                data = json.loads(email_payload_str)
            except Exception:
                return jsonify({'success': False, 'error': 'Invalid JSON'}), 400
            attachment = request.files.get('attachment')

        email_data = data.get('email_data', [])
        # The logged-in teacher is the sender
        teacher_email = g.current_user['user']
        gmail_app_password = str(data.get('gmail_app_password') or '').replace(' ', '')[:64]
        logger.info(f"📧 Sender: {teacher_email} | students: {len(email_data)}")

        attachment_payload = attachment.read() if attachment else None
        attachment_filename = attachment.filename if attachment else None

        email_sender, error, error_status = open_email_sender(g.current_user['id'], teacher_email, gmail_app_password)
        if error:
            logger.error(f"❌ {error}")
            return jsonify({'success': False, 'message': error, 'results': []}), error_status

        conn = get_db_connection()
        results = []
        successful_sends = []

        for idx, student in enumerate(email_data, 1):
            reg_no = student.get('reg_no', 'Unknown') if isinstance(student, dict) else 'Unknown'
            if not isinstance(student, dict) or 'reg_no' not in student:
                results.append({'reg_no': reg_no, 'status': 'failed', 'reason': 'Invalid student data format.'})
                continue

            try:
                student_email = _clean_email(student.get('student_email'))
                parent_email = _clean_email(student.get('parent_email'))
                if not student_email and not parent_email:
                    results.append({'reg_no': reg_no, 'name': student.get('name'), 'status': 'failed', 'reason': 'No valid student or parent email'})
                    continue

                subject = student.get('subject') or "Important: Attendance Notification"
                body_text = student.get('email_body', '')

                # Student is the main recipient; parent is CC'd (or main recipient if student email is missing)
                to_email = student_email or parent_email
                cc_email = parent_email if parent_email and parent_email != to_email else None

                success, msg = email_sender.send_email(
                    to_email=to_email,
                    subject=subject,
                    body_html=_text_to_html(body_text),
                    cc_email=cc_email,
                    attachment_data=attachment_payload,
                    attachment_filename=attachment_filename
                )
                recipients = [e for e in (to_email, cc_email) if e]
                results.append({
                    'reg_no': reg_no,
                    'name': student.get('name'),
                    'status': 'success' if success else 'failed',
                    'recipients': recipients,
                    'reason': None if success else msg
                })
                if success:
                    successful_sends.append({'name': student.get('name', 'N/A'), 'reg_no': reg_no, 'recipients': recipients})
                    _log_history(conn, reg_no, student.get('name'), subject, body_text, recipients, teacher_email)
                else:
                    logger.error(f"  ❌ {reg_no}: {msg}")

            except Exception as e:
                logger.error(f"Error sending to {reg_no}: {type(e).__name__}: {e}")
                conn.rollback()
                results.append({'reg_no': reg_no, 'name': student.get('name'), 'status': 'failed', 'reason': 'Unexpected error while sending'})

            logger.info(f"Progress: {idx}/{len(email_data)}")

        # Summary email to the teacher
        failed = [r for r in results if r['status'] != 'success']
        if successful_sends and len(email_data) > 1:
            rows = ''.join(
                f"<tr><td>{html.escape(str(s['name'] or ''))}</td><td>{s['reg_no']}</td><td>{html.escape(', '.join(s['recipients']))}</td></tr>"
                for s in successful_sends
            )
            failed_html = ''
            if failed:
                failed_html = "<p><strong>Not sent:</strong></p><ul>" + ''.join(
                    f"<li>{html.escape(str(r.get('name') or ''))} ({r['reg_no']}): {html.escape(str(r.get('reason') or ''))}</li>" for r in failed
                ) + "</ul>"
            summary_body = _email_layout('Email Delivery Summary', f"""
<p>Attendance notification emails were sent to {len(successful_sends)} student(s):</p>
<table border="1" cellpadding="8" style="border-collapse: collapse; font-size: 14px;">
<tr style="background-color: #f3f4f6;"><th>Student Name</th><th>Reg. No</th><th>Sent to</th></tr>{rows}</table>
{failed_html}""")
            email_sender.send_email(
                to_email=teacher_email,
                subject=f"Email Delivery Summary - {len(successful_sends)} sent, {len(failed)} failed",
                body_html=summary_body
            )

        conn.close()
        conn = None
        audit('emails_sent', f'{len(successful_sends)} student(s)', f'{len(failed)} failed')

        return jsonify({
            'success': True,
            'sent_count': len(successful_sends),
            'failed_count': len(failed),
            'results': results
        })

    except Exception as e:
        logger.error(f"Unexpected error in send_emails_endpoint: {e}")
        return server_error(e)
    finally:
        if email_sender:
            email_sender.logout()
        if conn:
            conn.close()


@app.route('/api/alert-all', methods=['POST'])
@token_required
def alert_all_students():
    """Send a mass alert to every student in the database from the teacher's Gmail account."""
    logger = logging.getLogger(__name__)
    logger.info("API HIT: alert_all_students")

    conn = None
    email_sender = None
    results = {'success_count': 0, 'fail_count': 0, 'failed_regs': []}
    try:
        alert_payload_str = request.form.get('alert_payload')
        if not alert_payload_str:
            return jsonify({'success': False, 'reason': 'Alert payload is missing.'}), 400
        try:
            data = json.loads(alert_payload_str)
        except Exception:
            return jsonify({'success': False, 'reason': 'Invalid JSON'}), 400

        attachment = request.files.get('attachment')
        subject = data.get('subject', 'Important Notification')
        email_body = data.get('email_body', '')
        teacher_email = g.current_user['user']
        gmail_app_password = str(data.get('gmail_app_password') or '').replace(' ', '')[:64]

        attachment_payload = attachment.read() if attachment else None
        attachment_filename = attachment.filename if attachment else None

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT "Reg.No", name, email, parent_email FROM students')
        all_students = cursor.fetchall()
        cursor.close()
        if not all_students:
            return jsonify({'success': False, 'reason': 'No students found in database.'}), 404
        logger.info(f"Found {len(all_students)} students to send alert to")

        email_sender, error, error_status = open_email_sender(g.current_user['id'], teacher_email, gmail_app_password)
        if error:
            return jsonify({'success': False, 'message': error}), error_status

        for idx, (reg_no, name, student_email, parent_email) in enumerate(all_students, 1):
            try:
                s_email = _clean_email(student_email)
                p_email = _clean_email(parent_email)
                if not s_email and not p_email:
                    results['fail_count'] += 1
                    results['failed_regs'].append(reg_no)
                    continue

                body_personalized = email_body.replace('[Student Name]', name or 'Student')
                to_email = s_email or p_email
                cc_email = p_email if p_email and p_email != to_email else None

                success, msg = email_sender.send_email(
                    to_email=to_email,
                    subject=subject,
                    body_html=_text_to_html(body_personalized),
                    cc_email=cc_email,
                    attachment_data=attachment_payload,
                    attachment_filename=attachment_filename
                )
                if success:
                    results['success_count'] += 1
                    _log_history(conn, reg_no, name, subject, body_personalized, [e for e in (to_email, cc_email) if e], teacher_email)
                else:
                    results['fail_count'] += 1
                    results['failed_regs'].append(reg_no)
                    logger.error(f"Failed to send to {reg_no}: {msg}")
            except Exception as e:
                logger.error(f"Error sending to {reg_no}: {e}")
                results['fail_count'] += 1
                results['failed_regs'].append(reg_no)
                conn.rollback()

            if idx % 10 == 0:
                logger.info(f"Progress: {idx}/{len(all_students)}")

        logger.info(f"✅ Alert complete - Success: {results['success_count']}, Failed: {results['fail_count']}")
        audit('mass_alert_sent', f"{results['success_count']} student(s)", f"subject: {subject}")
        return jsonify({'success': True, 'results': results})

    except Exception as e:
        logger.error(f"Unexpected error in alert_all_students: {e}")
        return server_error(e)
    finally:
        if email_sender:
            email_sender.logout()
        if conn:
            conn.close()

@app.route('/api/email/test-connection', methods=['POST'])
@token_required
def test_email_connection():
    """Check the teacher's Gmail app password without sending anything."""
    gmail_app_password = str((request.get_json(silent=True) or {}).get('gmail_app_password') or '').replace(' ', '')[:64]
    teacher_email = g.current_user['user']
    if _throttled(f'gmail-test:{g.current_user["id"]}', 10, 600):
        return too_many_requests()
    email_sender, error, error_status = open_email_sender(g.current_user['id'], teacher_email, gmail_app_password)
    if error:
        return jsonify({'success': False, 'message': error}), error_status
    via = 'connected Gmail' if isinstance(email_sender, GmailApiSender) else 'app password'
    email_sender.logout()
    return jsonify({'success': True, 'message': f'Ready to send as {email_sender.sender_email} ({via}).'})


# Accepted spreadsheet headings for student import (lower-case, punctuation removed) -> students column
STUDENT_IMPORT_COLUMNS = {
    'regno': 'Reg.No', 'registrationnumber': 'Reg.No', 'registerno': 'Reg.No', 'registrationno': 'Reg.No', 'reg': 'Reg.No',
    'name': 'name', 'studentname': 'name',
    'section': 'section', 'sec': 'section',
    'department': 'department', 'dept': 'department', 'branch': 'department',
    'phone': 'phone_number', 'phonenumber': 'phone_number', 'mobile': 'phone_number', 'studentmobile': 'phone_number', 'studentphone': 'phone_number',
    'email': 'email', 'studentemail': 'email', 'emailid': 'email', 'officialemail': 'email',
    'parentmobile': 'parent_mobile', 'parentphone': 'parent_mobile', 'parentnumber': 'parent_mobile',
    'parentemail': 'parent_email', 'parentemailid': 'parent_email',
}


@app.route('/api/students/import', methods=['POST'])
@token_required
def import_students():
    """Create or update students from a CSV / Excel file (matched on Reg.No)."""
    file = request.files.get('file')
    if not file:
        return jsonify({'message': 'Please choose a CSV or Excel file.'}), 400
    try:
        if file.filename.lower().endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file, dtype=str)
        else:
            df = pd.read_csv(file, dtype=str)
    except Exception as e:
        logger.info(f'import parse error: {e}')
        return jsonify({'message': 'Could not read the file. Please upload a valid CSV or Excel (.xlsx) file.'}), 400

    df.columns = [STUDENT_IMPORT_COLUMNS.get(re.sub(r'[^a-z]', '', str(c).lower()), None) for c in df.columns]
    df = df.loc[:, [c is not None for c in df.columns]]
    df = df.loc[:, ~df.columns.duplicated()]
    if 'Reg.No' not in df.columns or 'name' not in df.columns:
        return jsonify({'message': 'The file needs at least "Reg.No" and "Name" columns.'}), 400
    df = df.fillna('')
    if len(df) > 10000:
        return jsonify({'message': 'Please import at most 10,000 students at a time.'}), 400

    fields = ['name', 'section', 'department', 'phone_number', 'email', 'parent_mobile', 'parent_email']
    created = updated = 0
    skipped = []
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        for idx, row in df.iterrows():
            reg_no = str(row['Reg.No']).strip().upper()
            name = str(row['name']).strip()
            if not REG_NO_PATTERN.fullmatch(reg_no) or not name:
                skipped.append({'row': int(idx) + 2, 'reg_no': reg_no, 'reason': 'Missing name or invalid Reg.No'})
                continue
            values = {f: str(row[f]).strip()[:100] if f in df.columns else None for f in fields}
            for key in ('email', 'parent_email'):
                if values.get(key) and not _clean_email(values[key]):
                    values[key] = None
            values['name'] = name.upper()
            cursor.execute('SELECT id FROM students WHERE "Reg.No" = %s ORDER BY id LIMIT 1', (reg_no,))
            existing = cursor.fetchone()
            if existing:
                # Only overwrite columns present in the file with non-empty values
                # Column names come from the fixed `fields` list above, never from the uploaded file
                sets = [(f, v) for f, v in values.items() if v]
                cursor.execute(
                    'UPDATE students SET ' + ', '.join(f'{f} = %s' for f, _ in sets) + ' WHERE id = %s',  # nosec B608 - whitelisted identifiers
                    [v for _, v in sets] + [existing[0]]
                )
                updated += 1
            else:
                cursor.execute(
                    'INSERT INTO students ("Reg.No", name, section, department, phone_number, email, parent_mobile, parent_email) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
                    (reg_no, values['name'], values['section'] or '', values['department'] or '', values['phone_number'], values['email'], values['parent_mobile'], values['parent_email'])
                )
                created += 1
        conn.commit()
        conn.close()
        audit('students_imported', f'{created} created, {updated} updated', f'{len(skipped)} skipped')
        return jsonify({'created': created, 'updated': updated, 'skipped': skipped[:200]})
    except Exception as e:
        if conn:
            conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/dashboard-analytics', methods=['GET'])
@token_required
def get_dashboard_analytics():
    """Live numbers from the history table (all teachers), plus the signed-in teacher's own totals."""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        me = g.current_user['user']
        cursor.execute("""
            SELECT
                COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE),
                COUNT(DISTINCT student_reg_no) FILTER (WHERE sent_at >= CURRENT_DATE),
                COUNT(*) FILTER (WHERE sent_at >= CURRENT_DATE - INTERVAL '6 days'),
                COUNT(*),
                COUNT(DISTINCT student_reg_no),
                COUNT(*) FILTER (WHERE teacher_email = %s),
                MAX(sent_at) FILTER (WHERE teacher_email = %s)
            FROM history
        """, (me, me))
        today, students_today, week, total, students_total, mine, my_last = cursor.fetchone()

        cursor.execute("SELECT subject FROM history WHERE subject IS NOT NULL GROUP BY subject ORDER BY count(*) DESC LIMIT 1")
        most_frequent = cursor.fetchone()

        cursor.execute("""
            SELECT student_reg_no, MAX(student_name), COUNT(*) AS email_count, MAX(sent_at)
            FROM history GROUP BY student_reg_no ORDER BY email_count DESC, MAX(sent_at) DESC LIMIT 5
        """)
        top_students = [{'reg_no': r[0], 'name': r[1], 'count': r[2], 'last_sent_at': r[3].isoformat() if r[3] else None} for r in cursor.fetchall()]

        cursor.execute("""
            SELECT d::date, COUNT(h.id)
            FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS d
            LEFT JOIN history h ON h.sent_at >= d AND h.sent_at < d + INTERVAL '1 day'
            GROUP BY d ORDER BY d
        """)
        daily = [{'date': r[0].isoformat(), 'count': r[1]} for r in cursor.fetchall()]

        cursor.execute("SELECT COUNT(*) FROM students")
        student_count = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        return jsonify({
            'emails_sent_today': today,
            'unique_students_contacted': students_today,
            'emails_this_week': week,
            'emails_total': total,
            'students_contacted_total': students_total,
            'my_emails_total': mine,
            'my_last_sent_at': my_last.isoformat() if my_last else None,
            'student_count': student_count,
            'most_frequent_subject': most_frequent[0] if most_frequent else None,
            'top_students': top_students,
            'daily': daily,
        })
    except Exception as e:
        if conn: conn.close()
        return server_error(e)

@app.route('/api/teachers', methods=['GET'])
@admin_required
def get_teachers():
    """List teachers. Optional ?status=pending|approved|rejected filter."""
    status = request.args.get('status')
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        sql = "SELECT id, name, email, is_admin, status, created_at, reviewed_at, reviewed_by FROM teachers"
        params = ()
        if status:
            sql += " WHERE status = %s"
            params = (status,)
        cursor.execute(sql + " ORDER BY created_at DESC NULLS LAST, name", params)
        teachers = [{
            'id': row[0], 'name': row[1], 'email': row[2], 'is_admin': row[3], 'status': row[4],
            'created_at': row[5].isoformat() if row[5] else None,
            'reviewed_at': row[6].isoformat() if row[6] else None,
            'reviewed_by': row[7]
        } for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify(teachers)
    except Exception as e:
        if conn: conn.close()
        return server_error(e)

@app.route('/api/teachers', methods=['POST'])
@admin_required
def create_teacher():
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        name = re.sub(r'\s+', ' ', str(data.get('name') or '')).strip()[:100]
        email = str(data.get('email') or '').strip().lower()[:100]
        password = str(data.get('password') or '')
        is_admin = bool(data.get('is_admin', False))

        if not name or not _clean_email(email) or not password:
            return jsonify({'message': 'Please enter a name, a valid email and a password.'}), 400
        problem = password_problem(password, email)
        if problem:
            return jsonify({'message': problem}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM teachers WHERE LOWER(email) = %s", (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already exists'}), 409

        # Teachers added by an admin are approved straight away
        cursor.execute(
            "INSERT INTO teachers (name, email, password_hash, is_admin, status, reviewed_at, reviewed_by) VALUES (%s, %s, %s, %s, 'approved', NOW(), %s)",
            (name, email, generate_password_hash(password, method='pbkdf2:sha256'), is_admin, g.current_user.get('user'))
        )
        conn.commit()
        cursor.close()
        conn.close()
        audit('teacher_created', email, f'admin={is_admin}')
        return jsonify({'message': 'Teacher created successfully'}), 201

    except Exception as e:
        if conn:
            conn.rollback()
            conn.close()
        return server_error(e)


def _review_teacher(teacher_id, new_status):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE teachers SET status = %s, reviewed_at = NOW(), reviewed_by = %s, token_version = token_version + 1 WHERE id = %s AND is_admin = FALSE RETURNING name, email",
            (new_status, g.current_user.get('user'), teacher_id)
        )
        teacher = cursor.fetchone()
        if not teacher:
            conn.rollback(); conn.close()
            return jsonify({'message': 'Teacher not found'}), 404
        conn.commit()
        conn.close()

        name, email = teacher
        audit(f'teacher_{new_status}', email)
        if new_status == 'approved':
            sent, _ = send_system_email(email, 'Your MonitorMail account is approved', _email_layout('Account approved', f"""
<p>Hello {html.escape(name)},</p>
<p>Your MonitorMail account has been approved. You can now sign in with <strong>{html.escape(email)}</strong> and the password you created during registration.</p>"""))
        else:
            sent, _ = send_system_email(email, 'Your MonitorMail registration', _email_layout('Registration not approved', f"""
<p>Hello {html.escape(name)},</p>
<p>Your MonitorMail registration was not approved. Please contact the administrator if you think this is a mistake.</p>"""))
        return jsonify({'message': f'{name} {new_status}.', 'email_sent': sent})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)


@app.route('/api/teachers/<int:teacher_id>/approve', methods=['POST'])
@admin_required
def approve_teacher(teacher_id):
    return _review_teacher(teacher_id, 'approved')


@app.route('/api/teachers/<int:teacher_id>/reject', methods=['POST'])
@admin_required
def reject_teacher(teacher_id):
    return _review_teacher(teacher_id, 'rejected')

@app.route('/api/teachers/<int:teacher_id>', methods=['PUT'])
@admin_required
def update_teacher(teacher_id):
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        name = re.sub(r'\s+', ' ', str(data.get('name') or '')).strip()[:100]
        email = str(data.get('email') or '').strip().lower()[:100]
        is_admin = bool(data.get('is_admin'))
        password = str(data.get('password') or '')
        if not name or not _clean_email(email):
            return jsonify({'message': 'Please enter a name and a valid email.'}), 400
        if teacher_id == g.current_user['id'] and not is_admin:
            return jsonify({'message': 'You cannot remove your own admin access.'}), 400
        if password:
            problem = password_problem(password, email)
            if problem:
                return jsonify({'message': problem}), 400
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM teachers WHERE LOWER(email) = %s AND id <> %s", (email, teacher_id))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Another teacher already uses this email.'}), 409
        if password:
            cursor.execute("UPDATE teachers SET name = %s, email = %s, is_admin = %s, password_hash = %s WHERE id = %s",
                           (name, email, is_admin, generate_password_hash(password, method='pbkdf2:sha256'), teacher_id))
        else:
            cursor.execute("UPDATE teachers SET name = %s, email = %s, is_admin = %s WHERE id = %s", (name, email, is_admin, teacher_id))
        if teacher_id != g.current_user['id']:
            _bump_token_version(cursor, teacher_id=teacher_id)  # role/password/email changes take effect immediately
        conn.commit()
        cursor.close()
        conn.close()
        audit('teacher_updated', email, f"admin={is_admin}{', password reset' if password else ''}")
        return jsonify({'message': 'Teacher updated successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/teachers/<int:teacher_id>', methods=['DELETE'])
@admin_required
def delete_teacher(teacher_id):
    conn = None
    try:
        if teacher_id == g.current_user.get('id'):
            return jsonify({'message': 'Admin cannot delete their own account'}), 403
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM teachers WHERE id = %s RETURNING email", (teacher_id,))
        deleted = cursor.fetchone()
        cursor.execute("DELETE FROM gmail_connections WHERE teacher_id = %s", (teacher_id,))
        conn.commit()
        cursor.close()
        conn.close()
        if deleted:
            audit('teacher_deleted', deleted[0])
        return jsonify({'message': 'Teacher deleted successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

# --- STUDENT MANAGEMENT ENDPOINTS ---
def _like_pattern(text):
    """Escape LIKE wildcards so a search is taken literally."""
    return '%' + re.sub(r'([\\%_])', r'\\\1', text) + '%'


def _student_payload(data):
    """Validate and normalise student fields. Returns (values, error_message)."""
    def field(key, limit):
        return re.sub(r'\s+', ' ', str(data.get(key) or '')).strip()[:limit]
    values = {
        'reg_no': field('reg_no', 20).upper(), 'name': field('name', 100).upper(), 'section': field('section', 10),
        'department': field('department', 10), 'phone_number': re.sub(r'[^\d+]', '', field('phone_number', 15)),
        'email': field('email', 100).lower(), 'parent_mobile': re.sub(r'[^\d+]', '', field('parent_mobile', 15)),
        'parent_email': field('parent_email', 100).lower(),
    }
    if not REG_NO_PATTERN.fullmatch(values['reg_no']):
        return None, 'Registration number must look like RA followed by 13 digits.'
    if not values['name']:
        return None, 'Name is required.'
    for key in ('email', 'parent_email'):
        if values[key] and not _clean_email(values[key]):
            return None, f"{'Student' if key == 'email' else 'Parent'} email is not a valid email address."
    return values, None


values_order = ['reg_no', 'name', 'section', 'department', 'phone_number', 'email', 'parent_mobile', 'parent_email']


@app.route('/api/students', methods=['GET'])
@token_required
def get_students():
    search_query = str(request.args.get('search', ''))[:100]
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, "Reg.No", name, section, department, phone_number, email, parent_mobile, parent_email FROM students '
            'WHERE "Reg.No" ILIKE %s OR name ILIKE %s ORDER BY name LIMIT 5000',
            (_like_pattern(search_query), _like_pattern(search_query))
        )
        students = [{'id': r[0],'reg_no': r[1],'name': r[2],'section': r[3],'department': r[4],'phone_number': r[5],'email': r[6],'parent_mobile': r[7],'parent_email': r[8]} for r in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify(students)
    except Exception as e:
        if conn: conn.close()
        return server_error(e)

@app.route('/api/students', methods=['POST'])
@token_required
def create_student():
    values, error = _student_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'message': error}), 400
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT 1 FROM students WHERE "Reg.No" = %s', (values['reg_no'],))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Registration number already exists'}), 409
        cursor.execute(
            'INSERT INTO students ("Reg.No", name, section, department, phone_number, email, parent_mobile, parent_email) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
            tuple(values[k] for k in values_order)
        )
        new_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        audit('student_created', values['reg_no'])
        return jsonify({'message': 'Student created successfully', 'id': new_id}), 201
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/students/<int:student_id>', methods=['PUT'])
@token_required
def update_student(student_id):
    values, error = _student_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'message': error}), 400
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE students SET "Reg.No" = %s, name = %s, section = %s, department = %s, phone_number = %s, email = %s, parent_mobile = %s, parent_email = %s WHERE id = %s',
            tuple(values[k] for k in values_order) + (student_id,)
        )
        conn.commit()
        cursor.close()
        conn.close()
        audit('student_updated', values['reg_no'])
        return jsonify({'message': 'Student updated successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
@admin_required
def delete_student(student_id):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM students WHERE id = %s RETURNING "Reg.No"', (student_id,))
        deleted = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        if deleted:
            audit('student_deleted', deleted[0])
        return jsonify({'message': 'Student deleted successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)


# --- Templates and History endpoints ---
def _template_payload(data):
    name = re.sub(r'\s+', ' ', str(data.get('name') or '')).strip()[:100]
    body = str(data.get('body') or '')[:20000]
    if not name or not body.strip():
        return None, 'Template name and body are required.'
    return (name, body), None


@app.route('/api/templates', methods=['GET'])
@token_required
def get_templates():
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, body FROM templates ORDER BY name")
        templates = [{'id': row[0], 'name': row[1], 'body': row[2]} for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify(templates)
    except Exception as e:
        if conn: conn.close()
        return server_error(e)

@app.route('/api/templates', methods=['POST'])
@token_required
def create_template():
    values, error = _template_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'message': error}), 400
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO templates (name, body) VALUES (%s, %s) RETURNING id, name, body", values)
        new_template = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        audit('template_created', values[0])
        return jsonify({'id': new_template[0], 'name': new_template[1], 'body': new_template[2]}), 201
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/templates/<int:template_id>', methods=['PUT'])
@token_required
def update_template(template_id):
    values, error = _template_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({'message': error}), 400
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE templates SET name = %s, body = %s WHERE id = %s", values + (template_id,))
        conn.commit()
        cursor.close()
        conn.close()
        audit('template_updated', values[0])
        return jsonify({'message': 'Template updated successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/templates/<int:template_id>', methods=['DELETE'])
@token_required
def delete_template(template_id):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM templates WHERE id = %s RETURNING name", (template_id,))
        deleted = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        if deleted:
            audit('template_deleted', deleted[0])
        return jsonify({'message': 'Template deleted successfully'})
    except Exception as e:
        if conn: conn.rollback(); conn.close()
        return server_error(e)

@app.route('/api/history', methods=['GET'])
@token_required
def get_history():
    """Teachers see the emails they sent; the admin sees everyone's."""
    search = _like_pattern(str(request.args.get('search', ''))[:100])
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        sql = ('SELECT id, student_reg_no, student_name, subject, body, recipients, sent_at, teacher_email FROM history '
               'WHERE (student_reg_no ILIKE %s OR student_name ILIKE %s)')
        params = [search, search]
        if not g.current_user['is_admin']:
            sql += ' AND LOWER(teacher_email) = %s'
            params.append(g.current_user['email'].lower())
        cursor.execute(sql + ' ORDER BY sent_at DESC LIMIT 1000', params)
        history_logs = [{'id': r[0],'student_reg_no': r[1],'student_name': r[2],'subject': r[3],'body': r[4],'recipients': r[5],'sent_at': r[6].isoformat(),'teacher_email': r[7]} for r in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify(history_logs)
    except Exception as e:
        if conn: conn.close()
        return server_error(e)


@app.route('/api/audit-log', methods=['GET'])
@admin_required
def get_audit_log():
    """Security log for the admin: sign-ins, approvals, deletions, password changes, sends."""
    conn = None
    try:
        limit = max(1, min(int(request.args.get('limit', 300)), 1000))
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, at, actor, action, target, details, ip FROM audit_log ORDER BY at DESC LIMIT %s", (limit,))
        rows = [{'id': r[0], 'at': r[1].isoformat(), 'actor': r[2], 'action': r[3], 'target': r[4], 'details': r[5], 'ip': r[6]} for r in cursor.fetchall()]
        cursor.close()
        conn.close()
        return jsonify(rows)
    except Exception as e:
        if conn: conn.close()
        return server_error(e)


# --- Email Monitor Endpoints ---
ALLOWED_IMAP_PORTS = {993, 143}


def _is_public_host(host):
    """Only allow mail servers on the public internet (blocks using the server to probe the local network)."""
    import ipaddress
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def _own_monitor(monitor_id):
    monitor = monitors.get(monitor_id)
    if monitor and monitor.get('owner_id') == g.current_user['id']:
        return monitor
    return None


@app.route('/api/monitors', methods=['GET'])
@token_required
def list_monitors():
    _ensure_monitor_thread()
    with monitor_lock:
        return jsonify([{
            'id': m['id'],
            'name': m.get('name'),
            'imap_host': m.get('imap_host'),
            'imap_port': m.get('imap_port'),
            'username': m.get('username'),
            'folder': m.get('folder'),
            'subject_contains': m.get('subject_contains'),
            'interval_seconds': m.get('interval_seconds'),
            'last_checked': m.get('last_checked')
        } for m in monitors.values() if m.get('owner_id') == g.current_user['id']])

@app.route('/api/monitors', methods=['POST'])
@token_required
def create_monitor():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get('name', '')).strip()[:100] or 'Unnamed Monitor'
    imap_host = str(payload.get('imap_host', '')).strip().lower()[:253]
    username = str(payload.get('username', '')).strip()[:100]
    password = str(payload.get('password', ''))[:200]
    folder = str(payload.get('folder', 'INBOX')).strip()[:100] or 'INBOX'
    subject_contains = str(payload.get('subject_contains', '')).strip()[:200]
    try:
        imap_port = int(payload.get('imap_port', 993))
        interval_seconds = max(30, min(int(payload.get('interval_seconds', 60)), 3600))
    except (TypeError, ValueError):
        return jsonify({'message': 'Port and interval must be numbers.'}), 400

    if not imap_host or not username or not password or not subject_contains:
        return jsonify({'message': 'IMAP host, email, password and keyword are required.'}), 400
    if imap_port not in ALLOWED_IMAP_PORTS or not re.fullmatch(r'[a-z0-9.-]+', imap_host) or not _is_public_host(imap_host):
        return jsonify({'message': 'Please use a public IMAP server (for example imap.gmail.com) on port 993.'}), 400
    with monitor_lock:
        if sum(1 for m in monitors.values() if m.get('owner_id') == g.current_user['id']) >= 5:
            return jsonify({'message': 'You can have at most 5 monitors.'}), 400

    monitor_id = str(uuid.uuid4())
    monitor = {
        'id': monitor_id,
        'owner_id': g.current_user['id'],
        'name': name,
        'imap_host': imap_host,
        'imap_port': imap_port,
        'username': username,
        'password': password,
        'folder': folder,
        'subject_contains': subject_contains,
        'interval_seconds': interval_seconds,
        'last_checked': 0,
        'seen_uids': set()
    }
    with monitor_lock:
        monitors[monitor_id] = monitor
        monitor_matches.setdefault(monitor_id, [])

    _ensure_monitor_thread()
    return jsonify({'id': monitor_id, 'name': name}), 201

@app.route('/api/monitors/<monitor_id>', methods=['DELETE'])
@token_required
def delete_monitor(monitor_id):
    with monitor_lock:
        if _own_monitor(monitor_id):
            monitors.pop(monitor_id, None)
            monitor_matches.pop(monitor_id, None)
            return jsonify({'message': 'Monitor deleted.'})
    return jsonify({'message': 'Monitor not found.'}), 404

@app.route('/api/monitors/<monitor_id>/matches', methods=['GET'])
@token_required
def get_monitor_matches(monitor_id):
    with monitor_lock:
        if not _own_monitor(monitor_id):
            return jsonify({'message': 'Monitor not found.'}), 404
        matches = list(monitor_matches.get(monitor_id, []))[-200:]
    return jsonify(matches)


@app.route('/api/export-excel-structured', methods=['POST'])
@token_required
def export_excel_structured():
    """
    Excel report of the review list. Body: {"students": [...]} as returned by /api/fetch-details
    (or the older {"sorted_csv_data": ...}). Sheets: Students (one row each) and Subjects (percent pivot).
    """
    data = request.get_json() or {}
    try:
        students = data.get('students')
        if isinstance(students, list):
            students = [s for s in students[:5000] if isinstance(s, dict)]
        else:
            df = _read_attendance_csv(data.get('sorted_csv_data', ''))
            students = [{'reg_no': reg, 'name': grp['Name'].iloc[0],
                         'subjects': grp[['Subject', 'Type', 'Percentage']].to_dict('records')} for reg, grp in df.groupby('Reg.No')]

        summary_rows, subject_rows = [], []
        for s in students:
            subjects = s.get('subjects') or []
            low = [x for x in subjects if float(x.get('Percentage', 100)) < ATTENDANCE_THRESHOLD]
            summary_rows.append({
                'Reg.No': s.get('reg_no'),
                'Name': (s.get('name') or '').title(),
                'Student Email': s.get('student_email') or '',
                'Parent Email': s.get('parent_email') or '',
                f'Subjects below {ATTENDANCE_THRESHOLD}%': len(low),
                'Lowest %': min((float(x['Percentage']) for x in subjects), default=None),
                'Low Subjects': ', '.join(f"{x['Subject']} ({float(x['Percentage']):.2f}%)" for x in low),
                'Last Emailed': (s.get('last_notified_at') or '')[:10],
            })
            for x in subjects:
                subject_rows.append({'Reg.No': s.get('reg_no'), 'Name': (s.get('name') or '').title(), 'Subject': x['Subject'], 'Percentage': float(x['Percentage'])})

        def safe_cell(value):
            # Stop spreadsheet formula injection (=, +, -, @ at the start of a text cell)
            if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
                return "'" + value
            return value
        summary_rows = [{k: safe_cell(v) for k, v in row.items()} for row in summary_rows]
        subject_rows = [{k: safe_cell(v) for k, v in row.items()} for row in subject_rows]

        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            pd.DataFrame(summary_rows).to_excel(writer, index=False, sheet_name='Students')
            if subject_rows:
                pivot_df = pd.DataFrame(subject_rows).pivot_table(index=['Reg.No', 'Name'], columns='Subject', values='Percentage', aggfunc='min').reset_index()
                pivot_df.to_excel(writer, index=False, sheet_name='Subjects')
            for sheet in writer.sheets.values():
                for column in sheet.columns:
                    width = max(len(str(c.value or '')) for c in column)
                    sheet.column_dimensions[column[0].column_letter].width = min(max(10, width + 2), 60)
                sheet.freeze_panes = 'A2'
        output.seek(0)
        name = f"Low_Attendance_{datetime.now().strftime('%Y-%m-%d')}.xlsx"
        return send_file(output, as_attachment=True, download_name=name, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    except Exception as e:
        return server_error(e)


@app.route('/api/health', methods=['GET'])
def health():
    """Used by the hosting platform to check the app is up (no data, no auth)."""
    try:
        conn = get_db_connection()
        conn.cursor().execute('SELECT 1')
        conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        logger.error(f"health check failed: {e}")
        return jsonify({'status': 'unavailable'}), 503


# --- Serve the built frontend (production: one origin for app + API) ---
FRONTEND_BUILD = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'build'))


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path.startswith('api/'):
        return jsonify({'message': 'Not found.'}), 404
    if not os.path.isdir(FRONTEND_BUILD):
        return jsonify({'message': 'MonitorMail API is running. Start the frontend with "npm start" in the frontend folder.'})
    full = os.path.abspath(os.path.join(FRONTEND_BUILD, path))
    if path and full.startswith(FRONTEND_BUILD + os.sep) and os.path.isfile(full):
        return send_file(full)
    return send_file(os.path.join(FRONTEND_BUILD, 'index.html'))


ensure_schema()
ensure_admin_exists()

if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')  # only this computer; set HOST=0.0.0.0 to allow the network
    port = int(os.environ.get('PORT', 5001))
    # Production server only - Flask's debug server can execute arbitrary code and must never be exposed
    from waitress import serve
    print(f"MonitorMail running on http://{host}:{port}")
    serve(app, host=host, port=port, threads=8, ident=None, max_request_body_size=MAX_UPLOAD_MB * 1024 * 1024)
