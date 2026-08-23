/*
  =========================================
  DATABASE LAYER — SQLite / PostgreSQL
  =========================================
  Controlled entirely by the DB_TYPE env var ("sqlite" or "postgres").
  Every caller (server.js) keeps using db.runQuery / db.getQuery / db.allQuery
  with plain "?" placeholders — this file handles converting those to "$1,$2..."
  and picking the right driver underneath, so nothing else needs to change.
*/

require('dotenv').config();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase(); // 'sqlite' | 'postgres'

// ----------------------------------------------------
// TABLE SCHEMA DEFINITIONS (dialect-neutral, generated below)
// ----------------------------------------------------
const TABLES = [
  {
    name: 'users',
    pk: 'user_id',
    columns: [
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'password_hash', type: 'TEXT', notNull: true },
      { name: 'role', type: 'TEXT', notNull: true }, // 'admin', 'teacher', 'student'
      { name: 'institution_type', type: 'TEXT', notNull: true }, // 'school', 'college'
      { name: 'identifier', type: 'TEXT', notNull: true, unique: true }, // staff_id or roll_no
      { name: 'class_id', type: 'TEXT' },
      { name: 'department', type: 'TEXT' },
      { name: 'status', type: 'TEXT', default: "'active'" }
    ]
  },
  {
    name: 'students',
    pk: 'student_id',
    columns: [
      { name: 'user_id', type: 'INTEGER' },
      { name: 'roll_no', type: 'TEXT' },
      { name: 'register_no', type: 'TEXT' },
      { name: 'admission_no', type: 'TEXT' },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'institution_type', type: 'TEXT', notNull: true },
      { name: 'class_id', type: 'TEXT' },
      { name: 'department', type: 'TEXT' },
      { name: 'course', type: 'TEXT' },
      { name: 'year', type: 'TEXT' },
      { name: 'semester', type: 'TEXT' },
      { name: 'section', type: 'TEXT' }
    ],
    foreignKeys: [{ col: 'user_id', ref: 'users(user_id)' }]
  },
  {
    name: 'teachers',
    pk: 'teacher_id',
    columns: [
      { name: 'user_id', type: 'INTEGER' },
      { name: 'staff_id', type: 'TEXT', notNull: true, unique: true },
      { name: 'name', type: 'TEXT', notNull: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'institution_type', type: 'TEXT', notNull: true },
      { name: 'department', type: 'TEXT' }
    ],
    foreignKeys: [{ col: 'user_id', ref: 'users(user_id)' }]
  },
  {
    name: 'subjects',
    pk: 'subject_id',
    columns: [
      { name: 'subject_name', type: 'TEXT', notNull: true },
      { name: 'subject_code', type: 'TEXT', notNull: true, unique: true },
      { name: 'teacher_id', type: 'INTEGER' },
      { name: 'class_id', type: 'TEXT' },
      { name: 'institution_type', type: 'TEXT', notNull: true }
    ],
    foreignKeys: [{ col: 'teacher_id', ref: 'teachers(teacher_id)' }]
  },
  {
    name: 'notes',
    pk: 'note_id',
    columns: [
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'teacher_id', type: 'INTEGER' },
      { name: 'class_id', type: 'TEXT' },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'description', type: 'TEXT' },
      { name: 'file_url', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' }
    ],
    foreignKeys: [
      { col: 'subject_id', ref: 'subjects(subject_id)' },
      { col: 'teacher_id', ref: 'teachers(teacher_id)' }
    ]
  },
  {
    name: 'attendance',
    pk: 'attendance_id',
    columns: [
      { name: 'student_id', type: 'INTEGER' },
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'date', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', notNull: true }, // 'Present', 'Absent', 'Late', 'Excused'
      { name: 'recorded_by', type: 'INTEGER' }
    ],
    foreignKeys: [
      { col: 'student_id', ref: 'students(student_id)' },
      { col: 'subject_id', ref: 'subjects(subject_id)' },
      { col: 'recorded_by', ref: 'teachers(teacher_id)' }
    ]
  },
  {
    name: 'marks',
    pk: 'mark_id',
    columns: [
      { name: 'student_id', type: 'INTEGER' },
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'exam_type', type: 'TEXT', notNull: true },
      { name: 'marks', type: 'REAL', notNull: true },
      { name: 'maximum_marks', type: 'REAL', notNull: true },
      { name: 'grade', type: 'TEXT' }
    ],
    foreignKeys: [
      { col: 'student_id', ref: 'students(student_id)' },
      { col: 'subject_id', ref: 'subjects(subject_id)' }
    ]
  },
  {
    name: 'achievements',
    pk: 'achievement_id',
    columns: [
      { name: 'student_id', type: 'INTEGER' },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'description', type: 'TEXT' },
      { name: 'date', type: 'TEXT' },
      { name: 'category', type: 'TEXT' },
      { name: 'certificate_url', type: 'TEXT' }
    ],
    foreignKeys: [{ col: 'student_id', ref: 'students(student_id)' }]
  },
  {
    name: 'timetable',
    pk: 'timetable_id',
    columns: [
      { name: 'class_id', type: 'TEXT', notNull: true },
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'teacher_id', type: 'INTEGER' },
      { name: 'day', type: 'TEXT', notNull: true },
      { name: 'start_time', type: 'TEXT', notNull: true },
      { name: 'end_time', type: 'TEXT', notNull: true },
      { name: 'room', type: 'TEXT', notNull: true },
      { name: 'institution_type', type: 'TEXT', notNull: true }
    ],
    foreignKeys: [
      { col: 'subject_id', ref: 'subjects(subject_id)' },
      { col: 'teacher_id', ref: 'teachers(teacher_id)' }
    ]
  },
  {
    name: 'exams',
    pk: 'exam_id',
    columns: [
      { name: 'class_id', type: 'TEXT', notNull: true },
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'exam_name', type: 'TEXT', notNull: true },
      { name: 'exam_type', type: 'TEXT', notNull: true },
      { name: 'date', type: 'TEXT', notNull: true },
      { name: 'start_time', type: 'TEXT', notNull: true },
      { name: 'end_time', type: 'TEXT', notNull: true },
      { name: 'examination_center', type: 'TEXT', notNull: true },
      { name: 'examination_hall', type: 'TEXT', notNull: true },
      { name: 'instructions', type: 'TEXT' },
      { name: 'institution_type', type: 'TEXT', notNull: true }
    ],
    foreignKeys: [{ col: 'subject_id', ref: 'subjects(subject_id)' }]
  },
  {
    name: 'examination_centers',
    pk: 'center_id',
    columns: [
      { name: 'center_name', type: 'TEXT', notNull: true, unique: true },
      { name: 'center_address', type: 'TEXT' },
      { name: 'building_name', type: 'TEXT' },
      { name: 'hall_number', type: 'TEXT' },
      { name: 'capacity', type: 'INTEGER' },
      { name: 'institution_type', type: 'TEXT', notNull: true },
      { name: 'status', type: 'TEXT', default: "'active'" }
    ]
  },
  {
    name: 'meetings',
    pk: 'meeting_id',
    columns: [
      { name: 'teacher_id', type: 'INTEGER' },
      { name: 'class_id', type: 'TEXT', notNull: true },
      { name: 'subject_id', type: 'INTEGER' },
      { name: 'meeting_title', type: 'TEXT', notNull: true },
      { name: 'scheduled_start', type: 'TEXT' },
      { name: 'scheduled_end', type: 'TEXT' },
      { name: 'actual_start', type: 'TEXT' },
      { name: 'actual_end', type: 'TEXT' },
      { name: 'meeting_status', type: 'TEXT', default: "'scheduled'" } // 'scheduled', 'active', 'ended'
    ],
    foreignKeys: [
      { col: 'teacher_id', ref: 'teachers(teacher_id)' },
      { col: 'subject_id', ref: 'subjects(subject_id)' }
    ]
  },
  {
    name: 'online_attendance',
    pk: 'online_attendance_id',
    columns: [
      { name: 'meeting_id', type: 'INTEGER' },
      { name: 'student_id', type: 'INTEGER' },
      { name: 'join_time', type: 'TEXT' },
      { name: 'leave_time', type: 'TEXT' },
      { name: 'duration', type: 'INTEGER' },
      { name: 'attendance_status', type: 'TEXT' }
    ],
    foreignKeys: [
      { col: 'meeting_id', ref: 'meetings(meeting_id)' },
      { col: 'student_id', ref: 'students(student_id)' }
    ]
  },
  {
    name: 'ai_attention_observations',
    pk: 'observation_id',
    columns: [
      { name: 'meeting_id', type: 'INTEGER' },
      { name: 'student_id', type: 'INTEGER' },
      { name: 'timestamp', type: 'TEXT', notNull: true },
      { name: 'observation_type', type: 'TEXT', notNull: true },
      { name: 'confidence_score', type: 'REAL' },
      { name: 'review_status', type: 'TEXT', default: "'pending'" },
      { name: 'note', type: 'TEXT' }
    ],
    foreignKeys: [
      { col: 'meeting_id', ref: 'meetings(meeting_id)' },
      { col: 'student_id', ref: 'students(student_id)' }
    ]
  },
  {
    name: 'notifications',
    pk: 'notification_id',
    columns: [
      { name: 'user_id', type: 'INTEGER' },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'message', type: 'TEXT', notNull: true },
      { name: 'type', type: 'TEXT', notNull: true },
      { name: 'is_read', type: 'INTEGER', default: '0' },
      { name: 'created_at', type: 'TEXT', default: 'CURRENT_TIMESTAMP' }
    ],
    foreignKeys: [{ col: 'user_id', ref: 'users(user_id)' }]
  }
];

const PK_BY_TABLE = TABLES.reduce((acc, t) => {
  acc[t.name] = t.pk;
  return acc;
}, {});

function columnSQL(col) {
  const parts = [col.name, col.type];
  if (col.notNull) parts.push('NOT NULL');
  if (col.unique) parts.push('UNIQUE');
  if (col.default !== undefined) parts.push(`DEFAULT ${col.default}`);
  return parts.join(' ');
}

function buildCreateTableSQL(table, dialect) {
  const pkLine =
    dialect === 'postgres'
      ? `${table.pk} SERIAL PRIMARY KEY`
      : `${table.pk} INTEGER PRIMARY KEY AUTOINCREMENT`;

  const cols = table.columns.map((c) => columnSQL(c));
  const fks = (table.foreignKeys || []).map((fk) => `FOREIGN KEY(${fk.col}) REFERENCES ${fk.ref}`);
  const allParts = [pkLine, ...cols, ...fks];

  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n  ${allParts.join(',\n  ')}\n)`;
}

// ----------------------------------------------------
// PLACEHOLDER CONVERSION ("?" -> "$1, $2, ...") for Postgres
// ----------------------------------------------------
function toPgSQL(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function extractInsertTable(sql) {
  const match = sql.match(/^\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
  return match ? match[1] : null;
}

// ----------------------------------------------------
// DRIVER: SQLite
// ----------------------------------------------------
let sqliteDb = null;

function initSqliteDriver() {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = process.env.SQLITE_PATH
    ? path.resolve(__dirname, process.env.SQLITE_PATH)
    : path.resolve(__dirname, 'classroom.db');
  sqliteDb = new sqlite3.Database(dbPath);
  console.log(`[database] Using SQLite at ${dbPath}`);
}

function sqliteRun(sql, params) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function sqliteGet(sql, params) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function sqliteAll(sql, params) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ----------------------------------------------------
// DRIVER: PostgreSQL
// ----------------------------------------------------
let pgPool = null;

function initPostgresDriver() {
  const { Pool } = require('pg');

  if (process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    console.log('[database] Using PostgreSQL via DATABASE_URL');
  } else {
    pgPool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'classroom',
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
    console.log(`[database] Using PostgreSQL at ${process.env.PG_HOST || 'localhost'}/${process.env.PG_DATABASE || 'classroom'}`);
  }
}

async function pgRun(sql, params) {
  const table = extractInsertTable(sql);
  const isInsert = /^\s*INSERT/i.test(sql);
  const hasReturning = /RETURNING/i.test(sql);
  let finalSQL = toPgSQL(sql);

  if (isInsert && !hasReturning && table && PK_BY_TABLE[table]) {
    finalSQL += ` RETURNING ${PK_BY_TABLE[table]}`;
  }

  const result = await pgPool.query(finalSQL, params);
  const lastID =
    result.rows && result.rows[0] && table && PK_BY_TABLE[table]
      ? result.rows[0][PK_BY_TABLE[table]]
      : undefined;

  return { lastID, changes: result.rowCount };
}

async function pgGet(sql, params) {
  const result = await pgPool.query(toPgSQL(sql), params);
  return result.rows[0];
}

async function pgAll(sql, params) {
  const result = await pgPool.query(toPgSQL(sql), params);
  return result.rows;
}

// ----------------------------------------------------
// PUBLIC UNIFIED API
// ----------------------------------------------------
function runQuery(sql, params = []) {
  return DB_TYPE === 'postgres' ? pgRun(sql, params) : sqliteRun(sql, params);
}

function getQuery(sql, params = []) {
  return DB_TYPE === 'postgres' ? pgGet(sql, params) : sqliteGet(sql, params);
}

function allQuery(sql, params = []) {
  return DB_TYPE === 'postgres' ? pgAll(sql, params) : sqliteAll(sql, params);
}

async function initDatabase() {
  console.log(`Initializing database (DB_TYPE=${DB_TYPE})...`);

  if (DB_TYPE === 'postgres') {
    initPostgresDriver();
  } else {
    initSqliteDriver();
  }

  for (const table of TABLES) {
    await runQuery(buildCreateTableSQL(table, DB_TYPE));
  }

  const userCount = await getQuery('SELECT count(*) as count FROM users');
  const count = Number(userCount.count);
  if (count === 0) {
    console.log('Seeding initial data...');
    await seedData();
  } else {
    console.log('Database already initialized.');
  }
}

async function seedData() {
  const salt = await bcrypt.genSalt(10);
  const defaultHash = await bcrypt.hash('password', salt);
  const adminHash = await bcrypt.hash('admin', salt);

  // 1. Seed Users (Admins, Teachers, Students)
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'admin', 'school', 'ADMIN_SCH')`,
    ['School Admin', 'admin@school.edu', adminHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'admin', 'college', 'ADMIN_COL')`,
    ['College Admin', 'admin@college.edu', adminHash]
  );

  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'teacher', 'school', 'SCH_T1001')`,
    ['Sarah Jenkins (Math)', 'sarah@school.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'teacher', 'school', 'SCH_T1002')`,
    ['Robert Miller (Physics)', 'robert@school.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'teacher', 'college', 'COL_F2001')`,
    ['Dr. Alan Turing (CS)', 'turing@college.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier)
     VALUES (?, ?, ?, 'teacher', 'college', 'COL_F2002')`,
    ['Dr. Marie Curie (Chemistry)', 'curie@college.edu', defaultHash]
  );

  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier, class_id)
     VALUES (?, ?, ?, 'student', 'school', 'SCH_S101', 'Grade 10-A')`,
    ['Alice Johnson', 'alice@school.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier, class_id)
     VALUES (?, ?, ?, 'student', 'school', 'SCH_S102', 'Grade 10-A')`,
    ['Bob Smith', 'bob@school.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier, class_id, department)
     VALUES (?, ?, ?, 'student', 'college', 'COL_C301', 'CS-A', 'Computer Science')`,
    ['Charlie Brown', 'charlie@college.edu', defaultHash]
  );
  await runQuery(
    `INSERT INTO users (name, email, password_hash, role, institution_type, identifier, class_id, department)
     VALUES (?, ?, ?, 'student', 'college', 'COL_C302', 'CS-A', 'Computer Science')`,
    ['Diana Prince', 'diana@college.edu', defaultHash]
  );

  // 2. Populate Teacher Profiles
  await runQuery(`INSERT INTO teachers (user_id, staff_id, name, email, institution_type, department) VALUES (3, 'SCH_T1001', 'Sarah Jenkins (Math)', 'sarah@school.edu', 'school', 'Mathematics')`);
  await runQuery(`INSERT INTO teachers (user_id, staff_id, name, email, institution_type, department) VALUES (4, 'SCH_T1002', 'Robert Miller (Physics)', 'robert@school.edu', 'school', 'Science')`);
  await runQuery(`INSERT INTO teachers (user_id, staff_id, name, email, institution_type, department) VALUES (5, 'COL_F2001', 'Dr. Alan Turing', 'turing@college.edu', 'college', 'Computer Science')`);
  await runQuery(`INSERT INTO teachers (user_id, staff_id, name, email, institution_type, department) VALUES (6, 'COL_F2002', 'Dr. Marie Curie', 'curie@college.edu', 'college', 'Chemistry')`);

  // 3. Populate Student Profiles
  await runQuery(`INSERT INTO students (user_id, roll_no, admission_no, name, email, institution_type, class_id, section) VALUES (7, 'SCH_S101', 'ADM2026001', 'Alice Johnson', 'alice@school.edu', 'school', 'Grade 10-A', 'A')`);
  await runQuery(`INSERT INTO students (user_id, roll_no, admission_no, name, email, institution_type, class_id, section) VALUES (8, 'SCH_S102', 'ADM2026002', 'Bob Smith', 'bob@school.edu', 'school', 'Grade 10-A', 'A')`);
  await runQuery(`INSERT INTO students (user_id, roll_no, register_no, name, email, institution_type, class_id, department, course, year, semester, section) VALUES (9, 'COL_C301', 'REG9001', 'Charlie Brown', 'charlie@college.edu', 'college', 'CS-A', 'Computer Science', 'B.Tech CS', '3', '5', 'A')`);
  await runQuery(`INSERT INTO students (user_id, roll_no, register_no, name, email, institution_type, class_id, department, course, year, semester, section) VALUES (10, 'COL_C302', 'REG9002', 'Diana Prince', 'diana@college.edu', 'college', 'CS-A', 'Computer Science', 'B.Tech CS', '3', '5', 'A')`);

  // 4. Populate Subjects
  await runQuery(`INSERT INTO subjects (subject_name, subject_code, teacher_id, class_id, institution_type) VALUES ('Advanced Mathematics', 'MATH101', 1, 'Grade 10-A', 'school')`);
  await runQuery(`INSERT INTO subjects (subject_name, subject_code, teacher_id, class_id, institution_type) VALUES ('Introductory Physics', 'PHYS101', 2, 'Grade 10-A', 'school')`);
  await runQuery(`INSERT INTO subjects (subject_name, subject_code, teacher_id, class_id, institution_type) VALUES ('Data Structures & Algorithms', 'CS301', 3, 'CS-A', 'college')`);
  await runQuery(`INSERT INTO subjects (subject_name, subject_code, teacher_id, class_id, institution_type) VALUES ('Organic Chemistry', 'CHM302', 4, 'CS-A', 'college')`);

  // 5. Populate Notes
  await runQuery(`INSERT INTO notes (subject_id, teacher_id, class_id, title, description, file_url) VALUES (1, 1, 'Grade 10-A', 'Calculus Basics', 'Introduction to derivatives and integration limits.', 'calculus_basics.pdf')`);
  await runQuery(`INSERT INTO notes (subject_id, teacher_id, class_id, title, description, file_url) VALUES (3, 3, 'CS-A', 'Binary Trees Lectures', 'Deep dive into Binary Search Trees and AVL Trees balancing.', 'binary_trees.pdf')`);

  // 6. Populate Attendance (last 5 days)
  const dates = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
  for (const date of dates) {
    await runQuery(`INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) VALUES (1, 1, ?, 'Present', 1)`, [date]);
    await runQuery(`INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) VALUES (2, 1, ?, 'Present', 1)`, [date]);
    await runQuery(`INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) VALUES (3, 3, ?, 'Present', 3)`, [date]);
    await runQuery(`INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) VALUES (4, 3, ?, 'Present', 3)`, [date]);
  }

  // 7. Populate Marks
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (1, 1, 'Unit Test', 45, 50, 'A')`);
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (1, 1, 'Quarterly Examination', 88, 100, 'A')`);
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (1, 2, 'Unit Test', 42, 50, 'B')`);
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (3, 3, 'Internal Marks', 19, 20, 'O')`);
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (3, 3, 'Assignment Marks', 9, 10, 'A+')`);
  await runQuery(`INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (3, 3, 'Semester Examination', 85, 100, 'O')`);

  // 8. Achievements
  await runQuery(`INSERT INTO achievements (student_id, title, description, date, category, certificate_url) VALUES (1, 'State Science Fair - 1st Place', 'Awarded for solar-powered micro-grid simulator project.', '2026-05-15', 'Academic', 'science_fair_cert.pdf')`);
  await runQuery(`INSERT INTO achievements (student_id, title, description, date, category, certificate_url) VALUES (3, 'Inter-College Hackathon Winner', 'Winner of Google Developer Student Club Hackathon.', '2026-07-22', 'Project', 'hackathon_cert.pdf')`);

  // 9. Timetable
  await runQuery(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) VALUES ('Grade 10-A', 1, 1, 'Monday', '09:00', '10:00', 'Room 201', 'school')`);
  await runQuery(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) VALUES ('Grade 10-A', 2, 2, 'Monday', '10:00', '11:00', 'Room 201', 'school')`);
  await runQuery(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) VALUES ('Grade 10-A', 1, 1, 'Wednesday', '09:00', '10:00', 'Room 201', 'school')`);
  await runQuery(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) VALUES ('CS-A', 3, 3, 'Monday', '09:00', '10:00', 'Lab 3', 'college')`);
  await runQuery(`INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) VALUES ('CS-A', 4, 4, 'Monday', '10:00', '11:00', 'Room 405', 'college')`);

  // 10. Examination Centers
  await runQuery(`INSERT INTO examination_centers (center_name, center_address, building_name, hall_number, capacity, institution_type) VALUES ('Main Examination Center', '123 Academy Road, Cityville', 'Alpha Block', 'Hall 2', 150, 'school')`);
  await runQuery(`INSERT INTO examination_centers (center_name, center_address, building_name, hall_number, capacity, institution_type) VALUES ('Science Block Exam Hub', '456 University Ave, Metro', 'Science Hall', 'Room 101', 200, 'college')`);

  // 11. Exams
  await runQuery(`INSERT INTO exams (class_id, subject_id, exam_name, exam_type, date, start_time, end_time, examination_center, examination_hall, instructions, institution_type) VALUES ('Grade 10-A', 1, 'Quarterly Exam', 'Quarterly Examination', '2026-09-10', '10:00 AM', '01:00 PM', 'Main Examination Center', 'Hall 2', 'Bring ID card and geometry set.', 'school')`);
  await runQuery(`INSERT INTO exams (class_id, subject_id, exam_name, exam_type, date, start_time, end_time, examination_center, examination_hall, instructions, institution_type) VALUES ('CS-A', 3, 'Semester End Exam', 'Semester Examination', '2026-09-15', '10:00 AM', '01:00 PM', 'Science Block Exam Hub', 'Room 101', 'ID Card is mandatory. No programmable calculators allowed.', 'college')`);

  // 12. Default meetings
  await runQuery(`INSERT INTO meetings (teacher_id, class_id, subject_id, meeting_title, scheduled_start, scheduled_end, meeting_status) VALUES (1, 'Grade 10-A', 1, 'Calculus Q&A Session', '2026-08-22 09:00:00', '2026-08-22 10:00:00', 'scheduled')`);
  await runQuery(`INSERT INTO meetings (teacher_id, class_id, subject_id, meeting_title, scheduled_start, scheduled_end, meeting_status) VALUES (3, 'CS-A', 3, 'Data Structures Live Lab', '2026-08-22 10:00:00', '2026-08-22 11:30:00', 'scheduled')`);

  // 13. Notifications
  await runQuery(`INSERT INTO notifications (user_id, title, message, type) VALUES (7, 'New Notes Uploaded', 'Sarah Jenkins uploaded Calculus Basics notes.', 'info')`);
  await runQuery(`INSERT INTO notifications (user_id, title, message, type) VALUES (7, 'Upcoming Quarterly Exam', 'Quarterly Exam for Advanced Mathematics scheduled on 2026-09-10.', 'warning')`);
  await runQuery(`INSERT INTO notifications (user_id, title, message, type) VALUES (9, 'DSA Assignment published', 'New study notes and important topics posted by Dr. Alan Turing.', 'info')`);

  console.log('Seeding complete.');
}

module.exports = {
  initDatabase,
  runQuery,
  getQuery,
  allQuery
};
