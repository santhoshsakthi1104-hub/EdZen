# Smart Classroom & Timetable Management App

A Smart Classroom and Timetable Management System with **School Edition** and
**College Edition** modes, role-based dashboards (Student, Teacher, Admin),
timetables, exam registries, online class meetings, and an AI-attentiveness
demo.

---

## 🔧 What changed in this update

The previous version had a hidden bug: **the frontend (`app.js`) never
actually talked to the backend.** It stored everything in the browser's
`localStorage` as a "mock DB." The Admin panel's *Provision Account* button
called a function (`adminAddUser`) that didn't exist at all, so adding a
student silently failed to do anything, and even if it had worked, it would
have only written to that one browser's local storage — never to
`classroom.db` — so a newly added student could never actually log in
against the real database.

This update fixes that:

1. **`adminAddUser` and `adjustAdminFormFields` are now implemented** in
   `app.js`. Provisioning a student/teacher sends a real `POST
   /api/admin/users` request to the backend.
2. **Login (`handleLogin`) now calls the real backend** (`POST
   /api/auth/login`) instead of checking the localStorage mock. Whatever is
   actually in the database is what determines who can log in.
3. **The Admin panel's user table is now fetched live** from
   `GET /api/admin/users` on every render, so it always reflects the real
   database — including anyone you just added.
4. **The database layer now supports both SQLite and PostgreSQL**, switched
   with one environment variable (`DB_TYPE`), with zero changes needed to
   `server.js`'s queries.

**Scope note:** only the flows above (login + admin "add user" + the admin
user list) are wired to the live database. Everything else — notes,
attendance, marks, timetable browsing, the AI attentiveness demo, etc. —
still runs on the original `localStorage` mock, exactly as before. Those
other tabs are unaffected and unchanged.

---

## Project Structure

```
smart-classroom-app/
├── index.html          # Main HTML structure
├── styles.css          # Styling
├── app.js              # Frontend logic (now calls the backend for auth + admin)
├── .vscode/launch.json # VS Code debug config (points at backend/server.js)
└── backend/
    ├── package.json
    ├── .env.example     # Copy to .env and configure
    ├── database.js      # SQLite / PostgreSQL data layer (switch via DB_TYPE)
    ├── server.js         # Express REST API
    ├── verify-setup.js   # DB verification script
    └── classroom.db      # SQLite file (only used when DB_TYPE=sqlite)
```

---

## Running it

### 1. Configure the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

- **Using SQLite (default, no extra setup):**
  ```
  DB_TYPE=sqlite
  SQLITE_PATH=./classroom.db
  ```
- **Using PostgreSQL instead:**
  ```
  DB_TYPE=postgres
  DATABASE_URL=postgres://user:password@host:5432/dbname
  ```
  (or set `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`
  individually if you don't have a single connection string). Set
  `PG_SSL=true` if your host requires SSL (most managed Postgres hosts do).

Also set:
```
JWT_SECRET=some-long-random-string
CORS_ORIGIN=*          # or your deployed frontend's URL, e.g. https://myapp.com
PORT=5000
```

### 2. Start the backend

```bash
npm start
```

On first run it creates all tables and seeds the same demo accounts as
before (see below). It logs which database it connected to.

You can sanity-check the DB independently with:
```bash
node verify-setup.js
```
(this only works against SQLite; against Postgres, check via `psql` or your
DB provider's console instead.)

### 3. Point the frontend at your backend

Open `app.js` and edit this line near the top:

```js
const API_BASE_URL = 'http://localhost:5000/api';
```

Change it to wherever you deploy the backend, e.g.:

```js
const API_BASE_URL = 'https://your-backend.example.com/api';
```

Then open `index.html` in a browser (or serve the folder with any static
file server).

---

## Default Login Credentials

Same as before — these are real accounts seeded into the database on first
run.

### 🏫 School Edition
- Student: `alice@school.edu` / Roll No `SCH_S101` / password `password`
- Teacher: `sarah@school.edu` / Staff ID `SCH_T1001` / password `password`
- Admin: `admin@school.edu` / Admin ID `ADMIN_SCH` / password `admin`

### 🎓 College Edition
- Student: `charlie@college.edu` / Register No `COL_C301` / password `password`
- Teacher: `turing@college.edu` / Staff ID `COL_F2001` / password `password`
- Admin: `admin@college.edu` / Admin ID `ADMIN_COL` / password `admin`

---

## Adding a student live (the fixed flow)

1. Log in as an Admin (`admin@school.edu` / `ADMIN_SCH` / `admin`, or the
   college equivalent).
2. Go to **Admin Panel → User Registration & Account Provisioning**.
3. Fill in the form and submit — this calls the backend, which inserts a
   row into `users` and `students` (or `teachers`) in the real database.
4. Log out, select **Student** (or Teacher) → the matching institution, and
   log in with the identifier and password you just set. This now checks
   the database record you just created.

---

## Switching between SQLite and PostgreSQL later

Nothing in `server.js` needs to change. Just update `.env`:

```
DB_TYPE=postgres
DATABASE_URL=postgres://...
```

and restart the backend. `database.js` auto-generates the correct schema
for whichever dialect you choose and converts `?` query placeholders to
Postgres's `$1, $2, …` under the hood.
