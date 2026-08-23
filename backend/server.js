require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-smart-classroom';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token is required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// Check Role Middleware
function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permission denied. Unauthorized role.' });
    }
    next();
  };
}

// ----------------------------------------------------
// AUTHENTICATION ENDPOINTS
// ----------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role, institutionType, identifier } = req.body;

  if (!email || !password || !role || !institutionType || !identifier) {
    return res.status(400).json({ error: 'All login fields are required.' });
  }

  try {
    const user = await db.getQuery(
      'SELECT * FROM users WHERE email = ? AND role = ? AND institution_type = ? AND identifier = ?',
      [email, role, institutionType, identifier]
    );

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials. User not found.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Your account is deactivated. Contact administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email, ID, or password.' });
    }

    // Retrieve profile details based on role
    let profile = { user_id: user.user_id, name: user.name, role: user.role, institution_type: user.institution_type, identifier: user.identifier };
    if (role === 'student') {
      const studentProfile = await db.getQuery('SELECT * FROM students WHERE user_id = ?', [user.user_id]);
      if (studentProfile) profile = { ...profile, ...studentProfile };
    } else if (role === 'teacher') {
      const teacherProfile = await db.getQuery('SELECT * FROM teachers WHERE user_id = ?', [user.user_id]);
      if (teacherProfile) profile = { ...profile, ...teacherProfile };
    }

    const token = jwt.sign(profile, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server authentication error.' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ----------------------------------------------------
// STUDENT DASHBOARD ENDPOINTS
// ----------------------------------------------------

// Details
app.get('/api/student/details', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const details = await db.getQuery('SELECT * FROM students WHERE user_id = ?', [req.user.user_id]);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve student details.' });
  }
});

/*Admin Dashbaord count api*/
app.get('/api/admin/all-student', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const details = await db.allQuery('SELECT * FROM students WHERE institution_type = ?', [req.user.institution_type]);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve student details.' });
  }
});

app.get('/api/admin/all-teachers', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const details = await db.allQuery('SELECT * FROM teachers WHERE institution_type = ?', [req.user.institution_type]);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve student details.' });
  }
});

// Notes (view relevant files)
app.get('/api/student/notes', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const notes = await db.allQuery(
      `SELECT n.*, s.subject_name, s.subject_code, t.name as teacher_name 
       FROM notes n
       JOIN subjects s ON n.subject_id = s.subject_id
       JOIN teachers t ON n.teacher_id = t.teacher_id
       WHERE n.class_id = ?`,
      [req.user.class_id]
    );
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve notes.' });
  }
});

// Attendance (subject-wise percentage summary)
app.get('/api/student/attendance', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!student) return res.status(404).json({ error: 'Student profile not found.' });

    // Aggregate attendance
    const attendanceSummary = await db.allQuery(
      `SELECT s.subject_name, s.subject_code,
       COUNT(a.attendance_id) as total_classes,
       SUM(CASE WHEN a.status = 'Present' OR a.status = 'Late' THEN 1 ELSE 0 END) as attended,
       SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent
       FROM subjects s
       LEFT JOIN attendance a ON s.subject_id = a.subject_id AND a.student_id = ?
       WHERE s.class_id = ?
       GROUP BY s.subject_id`,
      [student.student_id, req.user.class_id]
    );

    res.json(attendanceSummary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve attendance.' });
  }
});

// Marks
app.get('/api/student/marks', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!student) return res.status(404).json({ error: 'Student profile not found.' });

    const marks = await db.allQuery(
      `SELECT m.*, s.subject_name, s.subject_code 
       FROM marks m
       JOIN subjects s ON m.subject_id = s.subject_id
       WHERE m.student_id = ?`,
      [student.student_id]
    );
    res.json(marks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve marks.' });
  }
});

// Achievements
app.get('/api/student/achievements', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    const achievements = await db.allQuery(
      'SELECT * FROM achievements WHERE student_id = ?',
      [student.student_id]
    );
    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve achievements.' });
  }
});

// Timetable
app.get('/api/student/timetable', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const timetable = await db.allQuery(
      `SELECT t.*, s.subject_name, s.subject_code, f.name as teacher_name
       FROM timetable t
       JOIN subjects s ON t.subject_id = s.subject_id
       JOIN teachers f ON t.teacher_id = f.teacher_id
       WHERE t.class_id = ?
       ORDER BY CASE t.day 
         WHEN 'Monday' THEN 1 
         WHEN 'Tuesday' THEN 2 
         WHEN 'Wednesday' THEN 3 
         WHEN 'Thursday' THEN 4 
         WHEN 'Friday' THEN 5 
         WHEN 'Saturday' THEN 6 
         ELSE 7 END, t.start_time`,
      [req.user.class_id]
    );
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve timetable.' });
  }
});

// Exam Timetable
app.get('/api/student/exams', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const exams = await db.allQuery(
      `SELECT e.*, s.subject_name, s.subject_code
       FROM exams e
       JOIN subjects s ON e.subject_id = s.subject_id
       WHERE e.class_id = ?`,
      [req.user.class_id]
    );
    res.json(exams);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve exam timetable.' });
  }
});

// Join Active Online Meetings
app.get('/api/student/meetings', authenticateToken, requireRole(['student']), async (req, res) => {
  try {
    const meetings = await db.allQuery(
      `SELECT m.*, s.subject_name, s.subject_code, t.name as teacher_name
       FROM meetings m
       JOIN subjects s ON m.subject_id = s.subject_id
       JOIN teachers t ON m.teacher_id = t.teacher_id
       WHERE m.class_id = ? AND m.meeting_status IN ('scheduled', 'active')`,
      [req.user.class_id]
    );
    res.json(meetings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve active meetings.' });
  }
});

// ----------------------------------------------------
// TEACHER DASHBOARD ENDPOINTS
// ----------------------------------------------------

// Get classes assigned to the teacher
app.get('/api/teacher/classes', authenticateToken, requireRole(['teacher']), async (req, res) => {
  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);
    if (!teacher) return res.status(404).json({ error: 'Teacher profile not found.' });

    const classes = await db.allQuery(
      `SELECT DISTINCT class_id, subject_id, subject_name, subject_code 
       FROM subjects 
       WHERE teacher_id = ?`,
      [teacher.teacher_id]
    );
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve teacher classes.' });
  }
});

// Get students in an assigned class
app.get('/api/teacher/students', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { class_id } = req.query;
  if (!class_id) {
    return res.status(400).json({ error: 'Class ID is required.' });
  }

  try {
    // Basic verification - did the teacher teach this class?
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);
    const subjects = await db.allQuery(
      'SELECT subject_id FROM subjects WHERE teacher_id = ? AND class_id = ?',
      [teacher.teacher_id, class_id]
    );

    if (subjects.length === 0) {
      return res.status(403).json({ error: 'Unauthorized to view this class.' });
    }

    const students = await db.allQuery(
      `SELECT s.*, u.status as user_status
       FROM students s
       JOIN users u ON s.user_id = u.user_id
       WHERE s.class_id = ?`,
      [class_id]
    );

    // Attach student analytics
    for (let student of students) {
      // 1. Attendance percentage
      const att = await db.getQuery(
        `SELECT COUNT(*) as total, 
         SUM(CASE WHEN status = 'Present' OR status = 'Late' THEN 1 ELSE 0 END) as present
         FROM attendance WHERE student_id = ?`,
        [student.student_id]
      );
      student.attendance_percentage = att.total > 0 ? ((att.present / att.total) * 100).toFixed(1) : '100';

      // 2. Average Marks
      const markSum = await db.getQuery(
        `SELECT AVG(marks / maximum_marks * 100) as avg_mark 
         FROM marks WHERE student_id = ?`,
        [student.student_id]
      );
      student.average_mark = markSum.avg_mark ? markSum.avg_mark.toFixed(1) : 'N/A';

      // 3. Online participation (Total duration in minutes)
      const part = await db.getQuery(
        `SELECT SUM(duration) as total_min 
         FROM online_attendance WHERE student_id = ?`,
        [student.student_id]
      );
      student.online_participation_minutes = part.total_min || 0;
    }

    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve students.' });
  }
});

// Record Attendance
app.post('/api/teacher/attendance', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { student_id, subject_id, date, status } = req.body;
  if (!student_id || !subject_id || !date || !status) {
    return res.status(400).json({ error: 'Missing attendance details.' });
  }

  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);

    // Check if attendance already exists for this student, subject, and date
    const existing = await db.getQuery(
      'SELECT attendance_id FROM attendance WHERE student_id = ? AND subject_id = ? AND date = ?',
      [student_id, subject_id, date]
    );

    if (existing) {
      await db.runQuery(
        'UPDATE attendance SET status = ?, recorded_by = ? WHERE attendance_id = ?',
        [status, teacher.teacher_id, existing.attendance_id]
      );
    } else {
      await db.runQuery(
        'INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) VALUES (?, ?, ?, ?, ?)',
        [student_id, subject_id, date, status, teacher.teacher_id]
      );
    }

    // Trigger Notification for student
    const studentUser = await db.getQuery('SELECT user_id FROM students WHERE student_id = ?', [student_id]);
    if (studentUser) {
      const subject = await db.getQuery('SELECT subject_name FROM subjects WHERE subject_id = ?', [subject_id]);
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [studentUser.user_id, 'Attendance Updated', `Attendance for ${subject.subject_name} on ${date} recorded as ${status}.`, 'info']
      );
    }

    res.json({ success: true, message: 'Attendance recorded successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

// Record/Update Marks
app.post('/api/teacher/marks', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { student_id, subject_id, exam_type, marks, maximum_marks, grade } = req.body;
  if (!student_id || !subject_id || !exam_type || marks === undefined || !maximum_marks) {
    return res.status(400).json({ error: 'Missing marks details.' });
  }

  try {
    // Delete existing mark if recording a fresh one for the same exam type
    await db.runQuery(
      'DELETE FROM marks WHERE student_id = ? AND subject_id = ? AND exam_type = ?',
      [student_id, subject_id, exam_type]
    );

    await db.runQuery(
      'INSERT INTO marks (student_id, subject_id, exam_type, marks, maximum_marks, grade) VALUES (?, ?, ?, ?, ?, ?)',
      [student_id, subject_id, exam_type, marks, maximum_marks, grade || 'N/A']
    );

    // Notify student
    const studentUser = await db.getQuery('SELECT user_id FROM students WHERE student_id = ?', [student_id]);
    if (studentUser) {
      const subject = await db.getQuery('SELECT subject_name FROM subjects WHERE subject_id = ?', [subject_id]);
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [studentUser.user_id, 'Marks Published', `Your marks for ${subject.subject_name} (${exam_type}) have been published.`, 'success']
      );
    }

    res.json({ success: true, message: 'Marks saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save marks.' });
  }
});

// Upload Study Notes / Materials
app.post('/api/teacher/notes', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { subject_id, class_id, title, description, file_url } = req.body;
  if (!subject_id || !class_id || !title) {
    return res.status(400).json({ error: 'Subject, class, and title are required.' });
  }

  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);

    await db.runQuery(
      'INSERT INTO notes (subject_id, teacher_id, class_id, title, description, file_url) VALUES (?, ?, ?, ?, ?, ?)',
      [subject_id, teacher.teacher_id, class_id, title, description || '', file_url || '']
    );

    // Notify all students in the class
    const students = await db.allQuery('SELECT user_id FROM students WHERE class_id = ?', [class_id]);
    const subject = await db.getQuery('SELECT subject_name FROM subjects WHERE subject_id = ?', [subject_id]);
    for (let std of students) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [std.user_id, 'New Study Material Available', `New note: "${title}" has been uploaded for ${subject.subject_name}.`, 'info']
      );
    }

    res.json({ success: true, message: 'Study notes uploaded successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save study notes.' });
  }
});

// Add Achievement
app.post('/api/teacher/achievements', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { student_id, title, description, date, category, certificate_url } = req.body;
  if (!student_id || !title || !category) {
    return res.status(400).json({ error: 'Student, title, and category are required.' });
  }

  try {
    await db.runQuery(
      'INSERT INTO achievements (student_id, title, description, date, category, certificate_url) VALUES (?, ?, ?, ?, ?, ?)',
      [student_id, title, description || '', date || '', category, certificate_url || '']
    );

    // Notify student
    const studentUser = await db.getQuery('SELECT user_id FROM students WHERE student_id = ?', [student_id]);
    if (studentUser) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [studentUser.user_id, 'New Achievement Recorded', `Congratulations! Your achievement "${title}" has been added to your profile.`, 'success']
      );
    }

    res.json({ success: true, message: 'Achievement logged successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record achievement.' });
  }
});

// Timetable creation & edit (Teachers & Admins)
app.post('/api/teacher/timetable', authenticateToken, requireRole(['teacher', 'admin']), async (req, res) => {
  const { class_id, subject_id, day, start_time, end_time, room } = req.body;
  if (!class_id || !subject_id || !day || !start_time || !end_time || !room) {
    return res.status(400).json({ error: 'All timetable slot details are required.' });
  }

  try {
    const subject = await db.getQuery('SELECT teacher_id, institution_type FROM subjects WHERE subject_id = ?', [subject_id]);
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });

    await db.runQuery(
      `INSERT INTO timetable (class_id, subject_id, teacher_id, day, start_time, end_time, room, institution_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [class_id, subject_id, subject.teacher_id, day, start_time, end_time, room, subject.institution_type]
    );

    // Notify students
    const students = await db.allQuery('SELECT user_id FROM students WHERE class_id = ?', [class_id]);
    for (let std of students) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [std.user_id, 'Timetable Updated', `A new class slot on ${day} at ${start_time} has been added.`, 'info']
      );
    }

    res.json({ success: true, message: 'Timetable slot created successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update timetable.' });
  }
});

// Exams Management
app.post('/api/teacher/exams', authenticateToken, requireRole(['teacher', 'admin']), async (req, res) => {
  const { class_id, subject_id, exam_name, exam_type, date, start_time, end_time, examination_center, examination_hall, instructions } = req.body;
  if (!class_id || !subject_id || !exam_name || !exam_type || !date || !start_time || !end_time || !examination_center || !examination_hall) {
    return res.status(400).json({ error: 'All examination details are required.' });
  }

  try {
    const user = await db.getQuery('SELECT institution_type FROM users WHERE user_id = ?', [req.user.user_id]);

    await db.runQuery(
      `INSERT INTO exams (class_id, subject_id, exam_name, exam_type, date, start_time, end_time, examination_center, examination_hall, instructions, institution_type) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [class_id, subject_id, exam_name, exam_type, date, start_time, end_time, examination_center, examination_hall, instructions || '', user.institution_type]
    );

    // Notify students
    const students = await db.allQuery('SELECT user_id FROM students WHERE class_id = ?', [class_id]);
    for (let std of students) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [std.user_id, 'Exam Scheduled', `Exam: ${exam_name} for ${exam_type} scheduled on ${date}.`, 'warning']
      );
    }

    res.json({ success: true, message: 'Exam scheduled successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to schedule exam.' });
  }
});

// Get centers
app.get('/api/teacher/examination-centers', authenticateToken, async (req, res) => {
  try {
    const centers = await db.allQuery('SELECT * FROM examination_centers WHERE institution_type = ?', [req.user.institution_type]);
    res.json(centers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch examination centers.' });
  }
});

// ----------------------------------------------------
// MEETING / LIVE CLASSROOM ENDPOINTS
// ----------------------------------------------------

// Create classroom meeting
app.post('/api/teacher/meetings', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { class_id, subject_id, meeting_title, scheduled_start, scheduled_end } = req.body;
  if (!class_id || !subject_id || !meeting_title) {
    return res.status(400).json({ error: 'Missing meeting parameters.' });
  }

  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);

    await db.runQuery(
      `INSERT INTO meetings (teacher_id, class_id, subject_id, meeting_title, scheduled_start, scheduled_end, meeting_status) 
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
      [teacher.teacher_id, class_id, subject_id, meeting_title, scheduled_start || '', scheduled_end || '']
    );

    // Notify students
    const students = await db.allQuery('SELECT user_id FROM students WHERE class_id = ?', [class_id]);
    for (let std of students) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [std.user_id, 'Online Class Scheduled', `A new online classroom meeting "${meeting_title}" has been scheduled.`, 'info']
      );
    }

    res.json({ success: true, message: 'Meeting scheduled successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create meeting.' });
  }
});

// Start active meeting (Only teacher who created it can start)
app.post('/api/teacher/meetings/:meeting_id/start', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);
    const meeting = await db.getQuery('SELECT * FROM meetings WHERE meeting_id = ?', [meeting_id]);

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });
    if (meeting.teacher_id !== teacher.teacher_id) {
      return res.status(403).json({ error: 'Only the host teacher can start this class meeting.' });
    }

    const timestamp = new Date().toISOString();
    await db.runQuery(
      "UPDATE meetings SET meeting_status = 'active', actual_start = ? WHERE meeting_id = ?",
      [timestamp, meeting_id]
    );

    // Notify class
    const students = await db.allQuery('SELECT user_id FROM students WHERE class_id = ?', [meeting.class_id]);
    for (let std of students) {
      await db.runQuery(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [std.user_id, 'Online Class Started', `Class "${meeting.meeting_title}" has started. Click to join now!`, 'success']
      );
    }

    res.json({ success: true, message: 'Class started successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start meeting.' });
  }
});

// End active meeting (Only teacher who created it can end)
app.post('/api/teacher/meetings/:meeting_id/end', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const teacher = await db.getQuery('SELECT teacher_id FROM teachers WHERE user_id = ?', [req.user.user_id]);
    const meeting = await db.getQuery('SELECT * FROM meetings WHERE meeting_id = ?', [meeting_id]);

    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });
    if (meeting.teacher_id !== teacher.teacher_id) {
      return res.status(403).json({ error: 'Only the host teacher can end this class meeting.' });
    }

    const timestamp = new Date().toISOString();
    await db.runQuery(
      "UPDATE meetings SET meeting_status = 'ended', actual_end = ? WHERE meeting_id = ?",
      [timestamp, meeting_id]
    );

    // Finalize all active online attendance records (fill in duration and status)
    const activeSessions = await db.allQuery(
      "SELECT * FROM online_attendance WHERE meeting_id = ? AND leave_time IS NULL",
      [meeting_id]
    );

    for (let session of activeSessions) {
      const join = new Date(session.join_time);
      const leave = new Date(timestamp);
      const diffMs = leave - join;
      const durationMin = Math.round(diffMs / 1000 / 60);
      const attendanceStatus = durationMin >= 30 ? 'Present' : (durationMin > 10 ? 'Left early' : 'Absent');

      await db.runQuery(
        `UPDATE online_attendance 
         SET leave_time = ?, duration = ?, attendance_status = ? 
         WHERE online_attendance_id = ?`,
        [timestamp, durationMin, attendanceStatus, session.online_attendance_id]
      );

      // Auto-populate actual attendance record for the day
      await db.runQuery(
        `INSERT INTO attendance (student_id, subject_id, date, status, recorded_by) 
         VALUES (?, ?, ?, ?, ?)`,
        [session.student_id, meeting.subject_id, timestamp.split('T')[0], attendanceStatus === 'Present' ? 'Present' : 'Absent', teacher.teacher_id]
      );
    }

    res.json({ success: true, message: 'Class ended and attendance synced.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to end meeting.' });
  }
});

// Join meeting (Student log)
app.post('/api/meetings/:meeting_id/join', authenticateToken, async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!student) return res.status(403).json({ error: 'Only students can log attendance via joining.' });

    const timestamp = new Date().toISOString();

    // Check if session already exists
    const existing = await db.getQuery(
      'SELECT online_attendance_id FROM online_attendance WHERE meeting_id = ? AND student_id = ? AND leave_time IS NULL',
      [meeting_id, student.student_id]
    );

    if (!existing) {
      await db.runQuery(
        'INSERT INTO online_attendance (meeting_id, student_id, join_time) VALUES (?, ?, ?)',
        [meeting_id, student.student_id, timestamp]
      );
    }

    res.json({ success: true, message: 'Join log recorded.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join meeting.' });
  }
});

// Leave meeting (Student log)
app.post('/api/meetings/:meeting_id/leave', authenticateToken, async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!student) return res.status(403).json({ error: 'Student profile not found.' });

    const session = await db.getQuery(
      'SELECT * FROM online_attendance WHERE meeting_id = ? AND student_id = ? AND leave_time IS NULL',
      [meeting_id, student.student_id]
    );

    if (session) {
      const timestamp = new Date().toISOString();
      const join = new Date(session.join_time);
      const leave = new Date(timestamp);
      const diffMs = leave - join;
      const durationMin = Math.max(1, Math.round(diffMs / 1000 / 60)); // ensure min 1 min
      const attendanceStatus = durationMin >= 30 ? 'Present' : (durationMin > 10 ? 'Left early' : 'Absent');

      await db.runQuery(
        `UPDATE online_attendance 
         SET leave_time = ?, duration = ?, attendance_status = ? 
         WHERE online_attendance_id = ?`,
        [timestamp, durationMin, attendanceStatus, session.online_attendance_id]
      );
    }

    res.json({ success: true, message: 'Leave log recorded.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record leave log.' });
  }
});

// ----------------------------------------------------
// AI ATTENTIVENESS MONITORING ENDPOINTS
// ----------------------------------------------------

// Report observation (Student app calls this in the background)
app.post('/api/meetings/:meeting_id/ai-observe', authenticateToken, requireRole(['student']), async (req, res) => {
  const { meeting_id } = req.params;
  const { observation_type, confidence_score } = req.body;

  if (!observation_type || confidence_score === undefined) {
    return res.status(400).json({ error: 'Missing observation details.' });
  }

  try {
    const student = await db.getQuery('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await db.runQuery(
      `INSERT INTO ai_attention_observations (meeting_id, student_id, timestamp, observation_type, confidence_score, review_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [meeting_id, student.student_id, timestamp, observation_type, confidence_score]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save attention observation.' });
  }
});

// Get AI attention report for a meeting (Teacher only)
app.get('/api/teacher/meetings/:meeting_id/ai-reports', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { meeting_id } = req.params;

  try {
    const observations = await db.allQuery(
      `SELECT o.*, s.name as student_name, s.roll_no
       FROM ai_attention_observations o
       JOIN students s ON o.student_id = s.student_id
       WHERE o.meeting_id = ? AND o.observation_type != 'attentive'
       ORDER BY o.observation_id DESC`,
      [meeting_id]
    );

    res.json(observations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch AI attention reports.' });
  }
});

// Update review status of observation
app.post('/api/teacher/meetings/ai-reports/:observation_id/review', authenticateToken, requireRole(['teacher']), async (req, res) => {
  const { observation_id } = req.params;
  const { status, note } = req.body;

  try {
    await db.runQuery(
      'UPDATE ai_attention_observations SET review_status = ?, note = ? WHERE observation_id = ?',
      [status, note || '', observation_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to review observation.' });
  }
});

// ----------------------------------------------------
// NOTIFICATIONS ENDPOINTS
// ----------------------------------------------------
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notify = await db.allQuery(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY notification_id DESC LIMIT 15',
      [req.user.user_id]
    );
    res.json(notify);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

app.post('/api/notifications/:notification_id/read', authenticateToken, async (req, res) => {
  const { notification_id } = req.params;
  try {
    await db.runQuery(
      'UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?',
      [notification_id, req.user.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// ----------------------------------------------------
// ADMINISTRATOR PANEL ENDPOINTS
// ----------------------------------------------------

// Add teacher or student
app.post('/api/admin/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { name, email, password, role, identifier, class_id, department, course, year, semester, section } = req.body;

  if (!name || !email || !password || !role || !identifier) {
    return res.status(400).json({ error: 'Missing mandatory registration fields.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await db.runQuery(
      `INSERT INTO users (name, email, password_hash, role, institution_type, identifier, class_id, department) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, email, hash, role, req.user.institution_type, identifier, class_id || null, department || null]
    );

    const newUserId = result.lastID;

    // Create profile
    if (role === 'teacher') {
      await db.runQuery(
        `INSERT INTO teachers (user_id, staff_id, name, email, institution_type, department) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newUserId, identifier, name, email, req.user.institution_type, department || null]
      );
    } else if (role === 'student') {
      await db.runQuery(
        `INSERT INTO students (user_id, roll_no, register_no, name, email, institution_type, class_id, department, course, year, semester, section) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newUserId,
          identifier,
          req.user.institution_type === 'college' ? identifier : null,
          name,
          email,
          req.user.institution_type,
          class_id || null,
          department || null,
          course || null,
          year || null,
          semester || null,
          section || null
        ]
      );
    }

    res.json({ success: true, message: 'User added successfully.' });
  } catch (err) {
    console.error(err);
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Email or ID already exists.' });
    }
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

// View all users in system
app.get('/api/admin/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const users = await db.allQuery(
      'SELECT user_id, name, email, role, identifier, status, class_id, department FROM users WHERE institution_type = ?',
      [req.user.institution_type]
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// Create Subjects
app.post('/api/admin/subjects', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { subject_name, subject_code, teacher_id, class_id } = req.body;
  if (!subject_name || !subject_code || !teacher_id || !class_id) {
    return res.status(400).json({ error: 'Missing subject registration parameters.' });
  }

  try {
    await db.runQuery(
      `INSERT INTO subjects (subject_name, subject_code, teacher_id, class_id, institution_type) 
       VALUES (?, ?, ?, ?, ?)`,
      [subject_name, subject_code, teacher_id, class_id, req.user.institution_type]
    );
    res.json({ success: true, message: 'Subject created successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create subject.' });
  }
});

// Reset Password
app.post('/api/admin/reset-password', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { user_id, new_password } = req.body;
  if (!user_id || !new_password) return res.status(400).json({ error: 'Missing user ID or password.' });

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(new_password, salt);

    await db.runQuery('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, user_id]);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// Activate/Deactivate Account
app.post('/api/admin/toggle-status', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { user_id, status } = req.body;
  if (!user_id || !status) return res.status(400).json({ error: 'Missing details.' });

  try {
    await db.runQuery('UPDATE users SET status = ? WHERE user_id = ?', [status, user_id]);
    res.json({ success: true, message: `Account status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update account status.' });
  }
});

// Initialize database (SQLite or PostgreSQL, per DB_TYPE) then start listening
db.initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Smart Classroom Express server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
