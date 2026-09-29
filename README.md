# MonitorMail

MonitorMail lets SRM faculty advisors email students (and CC parents) whose attendance is below 75%, straight from the "Faculty Advisor's Consolidated Academic Status" PDF.

**Flow:** teacher signs in → uploads the attendance PDF → reviews the students below 75% → enters their Gmail app password → every student gets a personalised email listing their low subjects, and the teacher gets a delivery summary.

The files from before this version are kept in `Previous files/`.

---

## Project structure

```
backend/        Flask API (app.py), email sending (email_util.py), .env config, PDF check script
frontend/       React app (src/App.js, api.js, theme.js, ui.js)
launcher.py     Starts backend + frontend and opens the browser (MonitorMail.bat / CreateDesktopShortcut.vbs on Windows)
Previous files/ Original zips, old docs/scripts, and legacy files that contained secrets (keep private)
```

## Running locally

Prerequisites: Python 3.9+, Node 18+, PostgreSQL running locally.

1. **Backend config** – `backend/.env` (template: `backend/.env.template`):
   - `SECRET_KEY` – required, 32+ random characters (`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`). The server refuses to start without it.
   - `DATABASE_URL` – required. Tables and new columns are created automatically on start.
   - `ADMIN_EMAIL` – always kept as an approved admin. `ADMIN_PASSWORD` is only used to create it if missing and must be strong.
   - `SYSTEM_EMAIL` + `SYSTEM_EMAIL_APP_PASSWORD` – Gmail account + app password that sends OTP / approval emails.
   - `OTP_CONSOLE_FALLBACK=true` – local testing only: OTPs are printed in the backend console instead of emailed.
   - `HOST=127.0.0.1` (only this computer) or `0.0.0.0` (other computers on the network), `PORT=5001`.
   - `COOKIE_SECURE=true` when served over HTTPS; `TRUST_PROXY=true` only behind a reverse proxy.
2. **Development** (two terminals)
   ```bash
   cd backend && python3 -m pip install -r requirements.txt && python3 app.py   # API on http://127.0.0.1:5001
   cd frontend && npm install && npm start                                       # app on http://localhost:3000
   ```
   The React dev server proxies `/api` to the backend, so the app and API share one origin.
   Or run `python3 launcher.py` to start both (logs in `backend/backend.log` and `frontend/frontend.log`).
3. **Production / single computer**
   ```bash
   cd frontend && npm run build        # creates frontend/build
   cd ../backend && python3 app.py     # serves the app and the API on http://127.0.0.1:5001
   ```

## Deploying on Render

The repo includes a `Dockerfile` (builds the React app, then runs the Python server that serves both the app and the API) and a `render.yaml` blueprint.

1. Create a PostgreSQL database (e.g. Neon, free) and copy your data: `pg_dump --no-owner <local db> | psql "<cloud connection string>"`.
2. Create a Google OAuth client (Google Cloud Console → Gmail API + OAuth consent screen + Credentials → *Web application*) with redirect URI `https://<your-app>.onrender.com/api/google/callback`.
3. In Render: **New → Blueprint** (or a Docker web service, Free plan), and set `DATABASE_URL`, `ADMIN_EMAIL`, `SYSTEM_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `FRONTEND_ORIGIN` (your `https://….onrender.com` URL). `SECRET_KEY` is generated for you.
4. Sign in as the admin and click **Connect Gmail** (Account page) so OTP and approval emails can be sent.

Free hosts block SMTP, so on Render email goes through the Gmail API (HTTPS) using each teacher's connected Gmail. App passwords (SMTP) still work when running locally.

Health check: `GET /api/health`.

## Security

- **Sessions** are HttpOnly, SameSite=Strict cookies (page scripts can't read them) that expire after 12 hours. Every request is re-checked against the database, so deleting, rejecting or demoting a teacher, or changing a password, ends their sessions immediately.
- **CSRF**: every change needs the `X-Requested-With: MonitorMail` header, which other sites can't send.
- **Brute force**: sign-in is limited per IP and per account (5 failures → 15-minute lockout); OTP requests and checks are rate-limited, codes expire in 10 minutes and allow 5 tries.
- **No account discovery**: sign-in, registration and password reset give the same answer whether or not an email exists, and sign-in takes the same time either way.
- **Passwords**: 8+ characters with a letter and a number, common passwords refused; accounts that still use a known weak password (e.g. `admin123`) are blocked until reset. Stored as salted PBKDF2 hashes.
- **Least privilege**: only admins manage teachers, approvals, the security log and student deletion; teachers see only their own sent-email history and their own mail monitors.
- **Input handling**: all SQL is parameterised; inputs are length-limited and validated; uploads are checked by file signature (real PDF) and capped at 100 MB; email headers are stripped of line breaks; names are HTML-escaped in emails; Excel exports are protected against formula injection; Mail Monitor only connects to public IMAP servers on port 993/143.
- **No leaks**: the browser only sees generic error messages (details go to the server log); no source maps are published; strict security headers (CSP, no framing, no-referrer, no-store) are set on every response.
- **Security log** (admin): sign-ins, failed/blocked attempts, approvals, password changes, deletions, imports and sends, with IP addresses.
- Keep `backend/.env` and `Previous files/` private. Gmail app passwords typed in the UI are used for that request only and never stored.

## Teacher registration

1. On the sign-in screen, click **Not registered yet? Register here**.
2. Enter name, official **@srmist.edu.in** email and a password (8+ characters).
3. A 6-digit code is emailed from `SYSTEM_EMAIL` (valid 10 minutes, 5 attempts, resend after 60 s).
4. After verifying, the account is **pending**; the admin gets an email.
5. The admin approves or rejects it in the **Approvals** tab; the teacher is emailed either way.
6. Approved teachers sign in with the email and password they created.

Teachers added by the admin in **Teacher Management** are approved immediately.

## Sending attendance emails

1. **Low Attendance** page → drop the PDF. The report is read table-by-table; theory subjects keep their slot (e.g. `21CSC303J(B)`) and lab slots are labelled `(Lab)`, so both parts of a course are shown separately.
2. Students below 75% are listed with their low subjects and emails from the database. Students missing from the database are highlighted; add their emails in the review window (and **Save to DB**).
3. **Review & send** → **Connect Gmail** once (send-only permission; emails come from your own address). Without Google sign-in configured, enter a Gmail app password instead (kept in memory until you sign out).
4. Pick a template (placeholders `[Student Name]`, `[Subject List]`), edit any email, then **Send all emails**. Each student card shows Sent/Failed; retrying only resends the ones that didn't go out.

## Other features

- **Forgot password** – "Forgot password?" on the sign-in screen emails a 6-digit reset code (from `SYSTEM_EMAIL`).
- **Account page** – change your password and test your Gmail app password without sending anything.
- **Test before sending** – every app-password field has a **Test** button that logs in to Gmail and reports the exact problem.
- **Last emailed** – the review list shows when each student was last emailed and warns about anyone emailed in the last 24 hours.
- **Excel report** – the **Excel** button on the review list downloads a `Students` sheet and a per-subject `Subjects` sheet.
- **Student import** – Students → **Import CSV / Excel** adds new students and updates existing ones (matched on Reg.No); a sample CSV is provided.
- **Dashboard** – today / last 7 days / your totals, a 14-day activity chart, and the most-notified students.
- **Session expiry** – when the 24-hour login expires you are signed out with a message instead of seeing errors.

## Checking a PDF from the command line

```bash
cd backend
python3 test_pdf_parsing.py "../Previous files/My Student Attendance Status.pdf"
```
