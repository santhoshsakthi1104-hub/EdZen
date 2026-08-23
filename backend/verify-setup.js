const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function testDatabase() {
  console.log('--- START DATABASE VERIFICATION ---');
  try {
    await db.initDatabase();

    // Verify User Seeding
    const user = await db.getQuery('SELECT * FROM users WHERE email = ?', ['admin@school.edu']);
    if (user && user.role === 'admin') {
      console.log('✔ Admin user seeding verification: SUCCESS');
    } else {
      console.error('❌ Admin user seeding verification: FAILED');
      process.exit(1);
    }

    // Verify Password Match
    const isMatch = await bcrypt.compare('admin', user.password_hash);
    if (isMatch) {
      console.log('✔ Password hashing & verification: SUCCESS');
    } else {
      console.error('❌ Password hashing & verification: FAILED');
      process.exit(1);
    }

    // Verify Timetable loading
    const timetableRows = await db.allQuery('SELECT * FROM timetable WHERE class_id = ?', ['Grade 10-A']);
    if (timetableRows.length > 0) {
      console.log(`✔ Timetable loading: SUCCESS (${timetableRows.length} slots loaded)`);
    } else {
      console.error('❌ Timetable loading: FAILED');
      process.exit(1);
    }

    // Verify Student Profile linking
    const student = await db.getQuery('SELECT * FROM students WHERE email = ?', ['alice@school.edu']);
    if (student && student.roll_no === 'SCH_S101') {
      console.log('✔ Student profile association: SUCCESS');
    } else {
      console.error('❌ Student profile association: FAILED');
      process.exit(1);
    }

    console.log('--- ALL BACKEND CHECKS PASSED SUCCESSFULLY ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database Initialization / Verification error:', err);
    process.exit(1);
  }
}

testDatabase();
