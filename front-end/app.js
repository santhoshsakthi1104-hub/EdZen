/* 
  =========================================
  SMART CLASSROOM & TIMETABLE MANAGEMENT APP
  Main Application Core Logic (app.js)
  =========================================
*/

// --- STATE MANAGEMENT ---
let appState = {
  institution: null, // 'school', 'college'
  role: null,        // 'student', 'teacher', 'admin'
  currentUser: null, // Logged in user details
  activeTab: 'overview',
  activeMeeting: null, // Current active classroom meeting session
  streamActive: false,
  cameraActive: true,
  micActive: true,
  screenSharing: false,
  aiObservationTimer: null,
  classroomChatMessages: []
};

// ----------------------------------------------------
// LIVE BACKEND API CLIENT
// ----------------------------------------------------
// Login and the Admin "provision account" panel talk to the real Express +
// SQLite/PostgreSQL backend (server.js / database.js) instead of the
// localStorage mock below. Everything else in this file (notes, marks,
// timetable, AI attentiveness demo, etc.) still runs on the localStorage
// mock DB, exactly as it did before.
//
// >>> IMPORTANT: point this at your backend. <<<
// Local dev:      'http://localhost:5000/api'
// Deployed:       'https://YOUR-DEPLOYED-BACKEND-URL/api'
const API_BASE_URL = 'http://localhost:5000/api';

function getAuthToken() {
  try {
    const raw = localStorage.getItem('smart_auth_token');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.token || null;
  } catch (e) {
    return null;
  }
}

async function apiRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  console.log(token);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  } catch (networkErr) {
    throw new Error(
      `Could not reach the backend at ${API_BASE_URL}. Is the server running and is API_BASE_URL set correctly?`
    );
  }

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    // No JSON body (e.g. 204) — fine.
  }

  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed (HTTP ${response.status})`);
  }
  return data;
}

// --- DATA ACCESS LAYER (IndexedDB / LocalStorage Mock DB) ---
const MOCK_DB_VERSION = '1.0';

// Initial Seed Data mapping directly to database schema
const defaultSeedData = {
  users: [
    { user_id: 1, name: 'School Admin', email: 'admin@school.edu', role: 'admin', institution_type: 'school', identifier: 'ADMIN_SCH', status: 'active', password_hash: 'admin' },
    { user_id: 2, name: 'College Admin', email: 'admin@college.edu', role: 'admin', institution_type: 'college', identifier: 'ADMIN_COL', status: 'active', password_hash: 'admin' },
    { user_id: 3, name: 'Sarah Jenkins (Math)', email: 'sarah@school.edu', role: 'teacher', institution_type: 'school', identifier: 'SCH_T1001', status: 'active', password_hash: 'password' },
    { user_id: 4, name: 'Robert Miller (Physics)', email: 'robert@school.edu', role: 'teacher', institution_type: 'school', identifier: 'SCH_T1002', status: 'active', password_hash: 'password' },
    { user_id: 5, name: 'Dr. Alan Turing (CS)', email: 'turing@college.edu', role: 'teacher', institution_type: 'college', identifier: 'COL_F2001', status: 'active', password_hash: 'password' },
    { user_id: 6, name: 'Dr. Marie Curie (Chemistry)', email: 'curie@college.edu', role: 'teacher', institution_type: 'college', identifier: 'COL_F2002', status: 'active', password_hash: 'password' },
    { user_id: 7, name: 'Alice Johnson', email: 'alice@school.edu', role: 'student', institution_type: 'school', identifier: 'SCH_S101', status: 'active', class_id: 'Grade 10-A', password_hash: 'password' },
    { user_id: 8, name: 'Bob Smith', email: 'bob@school.edu', role: 'student', institution_type: 'school', identifier: 'SCH_S102', status: 'active', class_id: 'Grade 10-A', password_hash: 'password' },
    { user_id: 9, name: 'Charlie Brown', email: 'charlie@college.edu', role: 'student', institution_type: 'college', identifier: 'COL_C301', status: 'active', class_id: 'CS-A', department: 'Computer Science', password_hash: 'password' },
    { user_id: 10, name: 'Diana Prince', email: 'diana@college.edu', role: 'student', institution_type: 'college', identifier: 'COL_C302', status: 'active', class_id: 'CS-A', department: 'Computer Science', password_hash: 'password' }
  ],
  students: [
    { student_id: 1, user_id: 7, roll_no: 'SCH_S101', admission_no: 'ADM2026001', name: 'Alice Johnson', email: 'alice@school.edu', institution_type: 'school', class_id: 'Grade 10-A', section: 'A' },
    { student_id: 2, user_id: 8, roll_no: 'SCH_S102', admission_no: 'ADM2026002', name: 'Bob Smith', email: 'bob@school.edu', institution_type: 'school', class_id: 'Grade 10-A', section: 'A' },
    { student_id: 3, user_id: 9, roll_no: 'COL_C301', register_no: 'REG9001', name: 'Charlie Brown', email: 'charlie@college.edu', institution_type: 'college', class_id: 'CS-A', department: 'Computer Science', course: 'B.Tech CS', year: '3', semester: '5', section: 'A' },
    { student_id: 4, user_id: 10, roll_no: 'COL_C302', register_no: 'REG9002', name: 'Diana Prince', email: 'diana@college.edu', institution_type: 'college', class_id: 'CS-A', department: 'Computer Science', course: 'B.Tech CS', year: '3', semester: '5', section: 'A' }
  ],
  teachers: [
    { teacher_id: 1, user_id: 3, staff_id: 'SCH_T1001', name: 'Sarah Jenkins (Math)', email: 'sarah@school.edu', institution_type: 'school', department: 'Mathematics' },
    { teacher_id: 2, user_id: 4, staff_id: 'SCH_T1002', name: 'Robert Miller (Physics)', email: 'robert@school.edu', institution_type: 'school', department: 'Science' },
    { teacher_id: 3, user_id: 5, staff_id: 'COL_F2001', name: 'Dr. Alan Turing', email: 'turing@college.edu', institution_type: 'college', department: 'Computer Science' },
    { teacher_id: 4, user_id: 6, staff_id: 'COL_F2002', name: 'Dr. Marie Curie', email: 'curie@college.edu', institution_type: 'college', department: 'Chemistry' }
  ],
  subjects: [
    { subject_id: 1, subject_name: 'Advanced Mathematics', subject_code: 'MATH101', teacher_id: 1, class_id: 'Grade 10-A', institution_type: 'school' },
    { subject_id: 2, subject_name: 'Introductory Physics', subject_code: 'PHYS101', teacher_id: 2, class_id: 'Grade 10-A', institution_type: 'school' },
    { subject_id: 3, subject_name: 'Data Structures & Algorithms', subject_code: 'CS301', teacher_id: 3, class_id: 'CS-A', institution_type: 'college' },
    { subject_id: 4, subject_name: 'Organic Chemistry', subject_code: 'CHM302', teacher_id: 4, class_id: 'CS-A', institution_type: 'college' }
  ],
  notes: [
    { note_id: 1, subject_id: 1, teacher_id: 1, class_id: 'Grade 10-A', title: 'Calculus Basics Lecture 1', description: 'Introduction to limits, derivatives and simple integrals.', file_url: 'calculus_basics.pdf', created_at: '2026-08-19' },
    { note_id: 2, subject_id: 2, teacher_id: 2, class_id: 'Grade 10-A', title: 'Thermodynamics Guide', description: 'Formulas and notes on the Laws of Thermodynamics.', file_url: 'thermodynamics_laws.pdf', created_at: '2026-08-20' },
    { note_id: 3, subject_id: 3, teacher_id: 3, class_id: 'CS-A', title: 'Red-Black Tree Balancing Notes', description: 'Detailed visual guide on left and right rotations.', file_url: 'red_black_trees.pdf', created_at: '2026-08-20' }
  ],
  attendance: [
    { attendance_id: 1, student_id: 1, subject_id: 1, date: '2026-08-17', status: 'Present', recorded_by: 1 },
    { attendance_id: 2, student_id: 1, subject_id: 1, date: '2026-08-18', status: 'Present', recorded_by: 1 },
    { attendance_id: 3, student_id: 1, subject_id: 1, date: '2026-08-19', status: 'Absent', recorded_by: 1 },
    { attendance_id: 4, student_id: 1, subject_id: 1, date: '2026-08-20', status: 'Present', recorded_by: 1 },
    { attendance_id: 5, student_id: 1, subject_id: 1, date: '2026-08-21', status: 'Present', recorded_by: 1 },
    { attendance_id: 6, student_id: 2, subject_id: 1, date: '2026-08-17', status: 'Present', recorded_by: 1 },
    { attendance_id: 7, student_id: 2, subject_id: 1, date: '2026-08-18', status: 'Present', recorded_by: 1 },
    { attendance_id: 8, student_id: 2, subject_id: 1, date: '2026-08-19', status: 'Present', recorded_by: 1 },
    { attendance_id: 9, student_id: 2, subject_id: 1, date: '2026-08-20', status: 'Absent', recorded_by: 1 },
    { attendance_id: 10, student_id: 2, subject_id: 1, date: '2026-08-21', status: 'Present', recorded_by: 1 },
    { attendance_id: 11, student_id: 3, subject_id: 3, date: '2026-08-21', status: 'Present', recorded_by: 3 }
  ],
  marks: [
    { mark_id: 1, student_id: 1, subject_id: 1, exam_type: 'Unit Test', marks: 45, maximum_marks: 50, grade: 'A' },
    { mark_id: 2, student_id: 1, subject_id: 1, exam_type: 'Quarterly Examination', marks: 88, maximum_marks: 100, grade: 'A' },
    { mark_id: 3, student_id: 1, subject_id: 2, exam_type: 'Unit Test', marks: 42, maximum_marks: 50, grade: 'B' },
    { mark_id: 4, student_id: 3, subject_id: 3, exam_type: 'Internal Marks', marks: 19, maximum_marks: 20, grade: 'O' },
    { mark_id: 5, student_id: 3, subject_id: 3, exam_type: 'Assignment Marks', marks: 9.2, maximum_marks: 10, grade: 'A+' },
    { mark_id: 6, student_id: 3, subject_id: 3, exam_type: 'Semester Examination', marks: 85, maximum_marks: 100, grade: 'O' }
  ],
  achievements: [
    { achievement_id: 1, student_id: 1, title: 'State Science Fair Winner', description: 'Won 1st prize for building a mini solar charging station.', date: '2026-05-15', category: 'Academic', certificate_url: 'solar_cert.pdf' },
    { achievement_id: 2, student_id: 3, title: 'Inter-College Hackathon Gold', description: 'Awarded first place for creating a smart waste classifier.', date: '2026-07-22', category: 'Project', certificate_url: 'hackathon_cert.pdf' }
  ],
  timetable: [
    { timetable_id: 1, class_id: 'Grade 10-A', subject_id: 1, teacher_id: 1, day: 'Monday', start_time: '09:00', end_time: '10:00', room: 'Room 201', institution_type: 'school' },
    { timetable_id: 2, class_id: 'Grade 10-A', subject_id: 2, teacher_id: 2, day: 'Monday', start_time: '10:00', end_time: '11:00', room: 'Room 201', institution_type: 'school' },
    { timetable_id: 3, class_id: 'Grade 10-A', subject_id: 1, teacher_id: 1, day: 'Wednesday', start_time: '09:00', end_time: '10:00', room: 'Room 201', institution_type: 'school' },
    { timetable_id: 4, class_id: 'Grade 10-A', subject_id: 2, teacher_id: 2, day: 'Friday', start_time: '11:00', end_time: '12:00', room: 'Room 201', institution_type: 'school' },
    { timetable_id: 5, class_id: 'CS-A', subject_id: 3, teacher_id: 3, day: 'Monday', start_time: '09:00', end_time: '10:00', room: 'Lab 3', institution_type: 'college' },
    { timetable_id: 6, class_id: 'CS-A', subject_id: 4, teacher_id: 4, day: 'Monday', start_time: '10:00', end_time: '11:00', room: 'Room 405', institution_type: 'college' },
    { timetable_id: 7, class_id: 'CS-A', subject_id: 3, teacher_id: 3, day: 'Tuesday', start_time: '11:30', end_time: '12:30', room: 'Room 302', institution_type: 'college' }
  ],
  exams: [
    { exam_id: 1, class_id: 'Grade 10-A', subject_id: 1, exam_name: 'Quarterly Exam', exam_type: 'Quarterly Examination', date: '2026-09-10', start_time: '10:00 AM', end_time: '01:00 PM', examination_center: 'Main Examination Center', examination_hall: 'Hall 2', instructions: 'Bring official ID card and geometry set. No mobile phones.', institution_type: 'school' },
    { exam_id: 2, class_id: 'CS-A', subject_id: 3, exam_name: 'Semester End Assessment', exam_type: 'Semester Examination', date: '2026-09-15', start_time: '10:00 AM', end_time: '01:00 PM', examination_center: 'Science Block Exam Hub', examination_hall: 'Room 101', instructions: 'Calculator and ID card mandatory. Arrive 30 mins early.', institution_type: 'college' }
  ],
  examination_centers: [
    { center_id: 1, center_name: 'Main Examination Center', center_address: '123 Academy Road, Cityville', building_name: 'Alpha Block', hall_number: 'Hall 2', capacity: 150, institution_type: 'school', status: 'active' },
    { center_id: 2, center_name: 'Science Block Exam Hub', center_address: '456 University Ave, Metro', building_name: 'Science Hall', hall_number: 'Room 101', capacity: 200, institution_type: 'college', status: 'active' },
    { center_id: 3, center_name: 'Anatomy Auditorium', center_address: 'Medical Building Complex', building_name: 'Omega Wing', hall_number: 'Auditorium 1', capacity: 350, institution_type: 'college', status: 'active' }
  ],
  meetings: [
    { meeting_id: 1, teacher_id: 1, class_id: 'Grade 10-A', subject_id: 1, meeting_title: 'Calculus Q&A Session', scheduled_start: '2026-08-22 09:00', scheduled_end: '2026-08-22 10:00', meeting_status: 'scheduled' },
    { meeting_id: 2, teacher_id: 3, class_id: 'CS-A', subject_id: 3, meeting_title: 'Data Structures Live Lecture', scheduled_start: '2026-08-22 10:00', scheduled_end: '2026-08-22 11:30', meeting_status: 'scheduled' }
  ],
  online_attendance: [],
  ai_attention_observations: [
    { observation_id: 1, meeting_id: 2, student_id: 3, timestamp: '10:35 AM', observation_type: 'looking_away', confidence_score: 0.88, review_status: 'pending' },
    { observation_id: 2, meeting_id: 2, student_id: 4, timestamp: '10:48 AM', observation_type: 'camera_off', confidence_score: 0.95, review_status: 'pending' }
  ],
  notifications: [
    { notification_id: 1, user_id: 7, title: 'New Notes Uploaded', message: 'Sarah Jenkins uploaded Calculus Basics Lecture 1 notes.', type: 'info', is_read: 0, created_at: '2026-08-21 14:00' },
    { notification_id: 2, user_id: 7, title: 'Upcoming Quarterly Exam', message: 'Advanced Mathematics Quarterly Exam scheduled on 2026-09-10.', type: 'warning', is_read: 0, created_at: '2026-08-21 15:30' },
    { notification_id: 3, user_id: 9, title: 'New Study Materials', message: 'Dr. Alan Turing uploaded Binary Trees details.', type: 'info', is_read: 0, created_at: '2026-08-21 12:00' }
  ]
};

// Initialize local DB on load
function dbInit() {
  if (!localStorage.getItem('smart_classroom_db')) {
    localStorage.setItem('smart_classroom_db', JSON.stringify(defaultSeedData));
  }
}

function dbGet(table) {
  const db = JSON.parse(localStorage.getItem('smart_classroom_db'));
  return db[table] || [];
}

function dbSave(table, data) {
  const db = JSON.parse(localStorage.getItem('smart_classroom_db'));
  db[table] = data;
  localStorage.setItem('smart_classroom_db', JSON.stringify(db));
}

function dbInsert(table, record) {
  const tableData = dbGet(table);
  const nextId = tableData.length > 0 ? Math.max(...tableData.map(r => r[Object.keys(r)[0]])) + 1 : 1;
  const key = Object.keys(tableData[0] || { id: 0 })[0];
  const newRecord = { [key]: nextId, ...record };
  tableData.push(newRecord);
  dbSave(table, tableData);
  return newRecord;
}

// ----------------------------------------------------
// BOOTSTRAPPING & DOM SELECTORS
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  dbInit();
  initClock();

  // Check if user is already logged in (persistence)
  const stored = localStorage.getItem('smart_auth_token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      appState.currentUser = parsed.user;
      appState.institution = parsed.user.institution_type;
      appState.role = parsed.user.role;

      // Confirm the session is still valid against the live backend
      // (token may have expired or the account may have been deactivated).
      if (parsed.token) {
        try {
          await apiRequest('/auth/me');
        } catch (e) {
          localStorage.removeItem('smart_auth_token');
          appState.currentUser = null;
          appState.institution = null;
          appState.role = null;
          return;
        }
      }

      enterDashboard();
    } catch (e) {
      localStorage.removeItem('smart_auth_token');
    }
  }
});

function initClock() {
  setInterval(() => {
    const timeDisplay = document.getElementById('current-time-display');
    if (timeDisplay) {
      const now = new Date();

      const formatted = now.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).replace(',', '').replaceAll('/', '-').toUpperCase();

      timeDisplay.textContent = formatted;

    }
  }, 1000);
}

// --- SELECTION FLOW ACTIONS ---

function selectInstitution(type) {
  appState.institution = type;

  // UI highlight selection
  const btns = document.querySelectorAll('#step-institution .option-btn');
  if (btns.length >= 2) {
    btns[0].classList.toggle('selected', type === 'school');
    btns[1].classList.toggle('selected', type === 'college');
  }

  setTimeout(() => {
    document.getElementById('step-institution').style.display = 'none';
    document.getElementById('step-role').style.display = 'block';
  }, 300);
}

function selectRole(role) {
  appState.role = role;

  const btns = document.querySelectorAll('#step-role .option-btn');
  if (btns.length >= 3) {
    btns[0].classList.toggle('selected', role === 'student');
    btns[1].classList.toggle('selected', role === 'teacher');
    btns[2].classList.toggle('selected', role === 'admin');
  }

  // Adjust login screen fields based on selections
  const title = document.getElementById('login-title');
  const idLabel = document.getElementById('login-id-label');
  const idInput = document.getElementById('login-id');

  if (role === 'student') {
    title.textContent = appState.institution === 'school' ? '🏫 School Student Login' : '🎓 College Student Login';
    idLabel.textContent = appState.institution === 'school' ? 'Roll Number / Admission Number' : 'Register Number / Roll Number';
    idInput.placeholder = appState.institution === 'school' ? 'e.g. SCH_S101' : 'e.g. COL_C301';
  } else if (role === 'teacher') {
    title.textContent = appState.institution === 'school' ? '🏫 School Teacher Login' : '🎓 College Faculty Login';
    idLabel.textContent = 'Institutional Staff ID';
    idInput.placeholder = appState.institution === 'school' ? 'e.g. SCH_T1001' : 'e.g. COL_F2001';
  } else {
    title.textContent = appState.institution === 'school' ? '🏫 School Admin Console' : '🎓 College Admin Console';
    idLabel.textContent = 'Administrator ID';
    idInput.placeholder = 'e.g. ADMIN_SCH';
  }

  setTimeout(() => {
    document.getElementById('step-role').style.display = 'none';
    document.getElementById('step-login').style.display = 'block';
  }, 300);
}

function backToStep(step) {
  document.getElementById('step-role').style.display = 'none';
  document.getElementById('step-login').style.display = 'none';

  if (step === 'institution') {
    document.getElementById('step-institution').style.display = 'block';
  } else if (step === 'role') {
    document.getElementById('step-role').style.display = 'block';
  }
}

// --- AUTHENTICATION ACTIONS ---

async function handleLogin(event) {
  if (event) event.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const id = document.getElementById('login-id').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorDiv = document.getElementById('login-error');

  errorDiv.style.display = 'none';

  const submitBtn = event && event.target && event.target.querySelector
    ? event.target.querySelector('button[type="submit"]')
    : null;
  if (submitBtn) submitBtn.disabled = true;

  try {
    // Live login against the real backend (SQLite/PostgreSQL) —
    // this is what makes admin-provisioned accounts able to sign in.
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        role: appState.role,
        institutionType: appState.institution,
        identifier: id
      })
    });

    appState.currentUser = data.user;
    localStorage.setItem('smart_auth_token', JSON.stringify({ token: data.token, user: data.user }));

    enterDashboard();
  } catch (err) {
    errorDiv.textContent = err.message || 'Login failed. Please check your credentials.';
    errorDiv.style.display = 'block';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function handleLogout() {
  // Clear camera timer and stream if active
  if (appState.aiObservationTimer) clearInterval(appState.aiObservationTimer);
  if (appState.streamActive) {
    const video = document.getElementById('classroom-video');
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
    }
  }

  localStorage.removeItem('smart_auth_token');
  appState.currentUser = null;
  appState.role = null;
  appState.institution = null;
  appState.activeMeeting = null;

  document.getElementById('app-dashboard').style.display = 'none';
  document.getElementById('flow-screens').style.display = 'flex';
  document.getElementById('step-login').style.display = 'none';
  document.getElementById('step-institution').style.display = 'block';

  // Clear inputs
  const form = document.getElementById('login-form');
  if (form) form.reset();
}

// ----------------------------------------------------
// SIDEBAR & DASHBOARD BUILDERS
// ----------------------------------------------------

function enterDashboard() {
  document.getElementById('flow-screens').style.display = 'none';
  document.getElementById('app-dashboard').style.display = 'flex';

  // Set edition badge
  const badge = document.getElementById('edition-badge');
  badge.textContent = appState.institution === 'school' ? 'School Edition' : 'College Edition';
  badge.className = `edition-badge ${appState.institution}`;

  // Populate user sidebar fields
  document.getElementById('sidebar-name').textContent = appState.currentUser.name;
  document.getElementById('sidebar-avatar').textContent = appState.currentUser.name.charAt(0);

  let roleTitle = appState.currentUser.role;
  if (roleTitle === 'teacher') {
    roleTitle = appState.institution === 'school' ? 'Teacher' : 'Faculty';
  }
  document.getElementById('sidebar-role').textContent = roleTitle;

  buildSidebarMenu();

  // Switch to default overview tab
  navigateToTab('overview');

  // Set up notifications indicator
  checkNotificationsCount();
}

function buildSidebarMenu() {
  const menuList = document.getElementById('sidebar-menu-list');
  menuList.innerHTML = '';

  const commonItems = [
    { id: 'overview', name: '🏠 Dashboard', roles: ['student', 'teacher', 'admin'] },
    { id: 'details', name: '👤 Details', roles: ['student'] },
    { id: 'mystudents', name: '👨‍🎓 My Students', roles: ['teacher'] },
    { id: 'notes', name: '📚 Notes', roles: ['student', 'teacher'] },
    { id: 'attendance', name: '📊 Attendance', roles: ['student', 'teacher'] },
    { id: 'marks', name: '📝 Marks', roles: ['student', 'teacher'] },
    { id: 'achievements', name: '🏆 Achievement', roles: ['student', 'teacher'] },
    { id: 'timetable', name: '📅 Timetable', roles: ['student', 'teacher'] },
    { id: 'exams', name: '📖 Exam Timetable', roles: ['student', 'teacher'] },
    { id: 'centers', name: '🏫 Examination Center', roles: ['student', 'teacher'] },
    { id: 'classroom', name: '🎥 Class Meeting', roles: ['student', 'teacher'] },
    { id: 'aireports', name: '🤖 AI Classroom Report', roles: ['teacher'] },
    { id: 'admin', name: '⚙️ Admin Panel', roles: ['admin'] }
  ];

  commonItems.forEach(item => {
    if (item.roles.includes(appState.role)) {
      const li = document.createElement('li');
      li.className = `menu-item ${item.id === appState.activeTab ? 'active' : ''}`;
      li.id = `menu-item-${item.id}`;
      li.innerHTML = `
        <a class="menu-link" onclick="navigateToTab('${item.id}')">
          ${item.name}
        </a>
      `;
      menuList.appendChild(li);
    }
  });
}

function navigateToTab(tabId) {
  // Update sidebar active selection
  document.querySelectorAll('.sidebar-menu .menu-item').forEach(el => el.classList.remove('active'));
  const activeMenu = document.getElementById(`menu-item-${tabId}`);
  if (activeMenu) activeMenu.classList.add('active');

  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');

  // Show target tab
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.style.display = 'block';

  appState.activeTab = tabId;

  // Set header title
  const workspaceTitle = document.getElementById('workspace-title');
  workspaceTitle.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1);

  // Trigger tab-specific loader
  loadTabData(tabId);
}

// ----------------------------------------------------
// TAB-SPECIFIC LOADERS
// ----------------------------------------------------

function loadTabData(tabId) {
  switch (tabId) {
    case 'overview':
      renderOverviewTab();
      break;
    case 'details':
      renderDetailsTab();
      break;
    case 'mystudents':
      renderMyStudentsTab();
      break;
    case 'notes':
      renderNotesTab();
      break;
    case 'attendance':
      renderAttendanceTab();
      break;
    case 'marks':
      renderMarksTab();
      break;
    case 'achievements':
      renderAchievementsTab();
      break;
    case 'timetable':
      renderTimetableTab();
      break;
    case 'exams':
      renderExamsTab();
      break;
    case 'centers':
      renderCentersTab();
      break;
    case 'classroom':
      renderClassroomTab();
      break;
    case 'aireports':
      renderAIReportsTab();
      break;
    case 'notifications':
      renderNotificationsTab();
      break;
    case 'admin':
      renderAdminTab();
      loadTeachersDropdown();
      break;
  }
}

// --- TAB: OVERVIEW RENDERER ---

async function renderOverviewTab() {
  const statsContainer = document.getElementById('dashboard-stats-container');
  statsContainer.innerHTML = '';

  // Show Class meeting banner if active
  const meetings = dbGet('meetings');
  const activeClass = meetings.find(m =>
    m.meeting_status === 'active' &&
    (appState.role === 'teacher' || m.class_id === appState.currentUser.class_id)
  );

  const banner = document.getElementById('active-meeting-banner');
  if (activeClass) {
    appState.activeMeeting = activeClass;
    document.getElementById('active-meeting-details').innerHTML = `
      <b>${activeClass.meeting_title}</b> is currently live for <b>${activeClass.class_id}</b>. 
      Click to enter the smart online lecture room.
    `;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }

  // Render statistics based on role
  if (appState.role === 'student') {
    const student = appState.currentUser;
    const marks = dbGet('marks').filter(m => m.student_id === student.student_id);
    const totalPercentage = marks.length > 0 ? (marks.reduce((acc, m) => acc + (m.marks / m.maximum_marks), 0) / marks.length * 100).toFixed(1) : '100';

    const attendance = dbGet('attendance').filter(a => a.student_id === student.student_id);
    const presentCount = attendance.filter(a => a.status === 'Present' || a.status === 'Late').length;
    const attendancePercent = attendance.length > 0 ? ((presentCount / attendance.length) * 100).toFixed(1) : '100';

    const achievementsCount = dbGet('achievements').filter(a => a.student_id === student.student_id).length;

    statsContainer.innerHTML = `
      <div class="card stat-card">
        <div class="stat-icon">📈</div>
        <div>
          <div class="stat-value">${attendancePercent}%</div>
          <div class="stat-label">Subject Attendance</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">📝</div>
        <div>
          <div class="stat-value">${totalPercentage}%</div>
          <div class="stat-label">Academic Score</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">🏆</div>
        <div>
          <div class="stat-value">${achievementsCount}</div>
          <div class="stat-label">Achievements Logged</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">📚</div>
        <div>
          <div class="stat-value">${student.class_id || 'N/A'}</div>
          <div class="stat-label">Assigned Class</div>
        </div>
      </div>
    `;
  } else if (appState.role === 'teacher') {
    const teacher = appState.currentUser;
    const subjects = dbGet('subjects').filter(s => s.teacher_id === teacher.teacher_id);
    const teacherClasses = [...new Set(subjects.map(s => s.class_id))];
    const totalStudents = dbGet('students').filter(s => teacherClasses.includes(s.class_id)).length;

    statsContainer.innerHTML = `
      <div class="card stat-card">
        <div class="stat-icon">👨‍🎓</div>
        <div>
          <div class="stat-value">${totalStudents}</div>
          <div class="stat-label">Total Assigned Students</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">📚</div>
        <div>
          <div class="stat-value">${subjects.length}</div>
          <div class="stat-label">Courses / Subjects Handled</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">📅</div>
        <div>
          <div class="stat-value">${teacherClasses.join(', ') || 'None'}</div>
          <div class="stat-label">Active Assigned Classes</div>
        </div>
      </div>
    `;
  } else if (appState.role === 'admin') {
    const adminUsers = await apiRequest('/admin/all-student');
    const adminTeachers = await apiRequest('/admin/all-teachers');
    const allStudents = adminUsers.filter(s => s.institution_type === appState.institution).length;
    const allTeachers = adminTeachers.filter(t => t.institution_type === appState.institution).length;
    const centers = dbGet('examination_centers').filter(c => c.institution_type === appState.institution).length;

    statsContainer.innerHTML = `
      <div class="card stat-card">
        <div class="stat-icon">👨‍🎓</div>
        <div>
          <div class="stat-value">${allStudents}</div>
          <div class="stat-label">Total Students</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">👨‍🏫</div>
        <div>
          <div class="stat-value">${allTeachers}</div>
          <div class="stat-label">Total Staff / Faculty</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-icon">🏫</div>
        <div>
          <div class="stat-value">${centers}</div>
          <div class="stat-label">Exam Centers</div>
        </div>
      </div>
    `;
  }

  renderTodayScheduleTable();
  renderQuickAnnouncements();
}

function renderTodayScheduleTable() {
  const tableBody = document.getElementById('today-schedule-table');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  const timetable = dbGet('timetable');
  const subjects = dbGet('subjects');
  const teachers = dbGet('teachers');

  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  let targetClassId = '';
  if (appState.role === 'student') {
    targetClassId = appState.currentUser.class_id;
  }

  let slots = timetable.filter(t =>
    t.institution_type === appState.institution &&
    t.day === dayName
  );

  if (appState.role === 'student') {
    slots = slots.filter(t => t.class_id === targetClassId);
  } else if (appState.role === 'teacher') {
    const teacherId = appState.currentUser.teacher_id;
    slots = slots.filter(t => t.teacher_id === teacherId);
  }

  if (slots.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No classes scheduled for today (${dayName}).</td></tr>`;
    return;
  }

  slots.sort((a, b) => a.start_time.localeCompare(b.start_time));

  slots.forEach(slot => {
    const sub = subjects.find(s => s.subject_id === slot.subject_id);
    const teach = teachers.find(t => t.teacher_id === slot.teacher_id);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><b>${slot.start_time} - ${slot.end_time}</b></td>
      <td>${sub ? sub.subject_name : 'Subject'} (${sub ? sub.subject_code : ''})</td>
      <td><span class="edition-badge">${slot.room}</span></td>
      <td>${teach ? teach.name : 'Staff'}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderQuickAnnouncements() {
  const container = document.getElementById('quick-announcements');
  if (!container) return;
  container.innerHTML = '';

  const list = [
    { title: '📝 Exam Hall Registrations Open', desc: 'Confirm exam centers mapping on sidebar.', date: '10 mins ago' },
    { title: '🛡️ AI Camera Policy updated', desc: 'Attentiveness tracking processed locally only.', date: '2 hours ago' }
  ];

  list.forEach(ann => {
    const el = document.createElement('div');
    el.style.cssText = 'background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); padding: 12px; border-radius: var(--border-radius-sm);';
    el.innerHTML = `
      <div style="font-weight: 600; font-size: 0.9rem; color: var(--accent-cyan);">${ann.title}</div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${ann.desc}</div>
      <div style="font-size: 0.7rem; color: var(--text-dim); text-align: right; margin-top: 2px;">${ann.date}</div>
    `;
    container.appendChild(el);
  });
}

// --- TAB: DETAILS RENDERER ---

function renderDetailsTab() {
  const container = document.getElementById('profile-details-grid');
  if (!container) return;
  container.innerHTML = '';

  const user = appState.currentUser;

  let fields = [];
  if (appState.institution === 'school') {
    fields = [
      { label: 'Full Student Name', val: user.name },
      { label: 'Roll Number', val: user.roll_no || user.identifier },
      { label: 'Admission Number', val: user.admission_no || 'ADM2026-99' },
      { label: 'Current Grade / Class', val: user.class_id },
      { label: 'Section', val: user.section || 'A' },
      { label: 'Registered Email', val: user.email }
    ];
  } else {
    fields = [
      { label: 'Full Student Name', val: user.name },
      { label: 'Register Number', val: user.register_no || user.identifier },
      { label: 'Department', val: user.department || 'Computer Science' },
      { label: 'Degree & Course', val: user.course || 'B.Tech CS' },
      { label: 'Year & Semester', val: `Year ${user.year || 3}, Semester ${user.semester || 5}` },
      { label: 'Section', val: user.section || 'A' },
      { label: 'Registered Email', val: user.email }
    ];
  }

  fields.forEach(f => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="font-size: 0.8rem; color: var(--text-muted);">${f.label}</div>
      <div style="font-size: 1.1rem; font-weight: 600; margin-top: 5px;">${f.val || 'N/A'}</div>
    `;
    container.appendChild(card);
  });
}

// --- TAB: MY STUDENTS RENDERER (TEACHERS) ---

function renderMyStudentsTab() {
  const container = document.getElementById('my-students-container');
  if (!container) return;

  const teacher = appState.currentUser;
  const subjects = dbGet('subjects').filter(s => s.teacher_id === teacher.teacher_id);
  const classIds = [...new Set(subjects.map(s => s.class_id))];

  const students = dbGet('students').filter(s => classIds.includes(s.class_id));

  let html = `
    <div class="card" style="margin-bottom: 20px;">
      <h3 style="margin-bottom: 15px;">Assigned Students Overview (${students.length})</h3>
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr>
              <th>ID / Roll</th>
              <th>Name</th>
              <th>Class / Dept</th>
              <th>Email</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (students.length === 0) {
    html += `<tr><td colspan="5" style="text-align: center;">No students found for your assigned classes.</td></tr>`;
  } else {
    students.forEach(st => {
      html += `
        <tr>
          <td><b>${st.roll_no || st.register_no}</b></td>
          <td>${st.name}</td>
          <td>${st.class_id} ${st.department ? `(${st.department})` : ''}</td>
          <td>${st.email}</td>
          <td>
            <button class="header-action-btn" onclick="openMarkAttendanceModal(${st.student_id})">Log Attendance</button>
          </td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}

// --- TAB: NOTES RENDERER ---

function renderNotesTab() {
  const list = document.getElementById('notes-list-container');
  if (!list) return;
  list.innerHTML = '';

  const notes = dbGet('notes');
  const subjects = dbGet('subjects');

  let filteredNotes = notes;
  if (appState.role === 'student') {
    filteredNotes = notes.filter(n => n.class_id === appState.currentUser.class_id);
  } else if (appState.role === 'teacher') {
    filteredNotes = notes.filter(n => n.teacher_id === appState.currentUser.teacher_id);
  }

  const uploadBtn = document.getElementById('upload-note-btn');
  if (uploadBtn) {
    uploadBtn.style.display = appState.role === 'teacher' ? 'block' : 'none';
  }

  if (filteredNotes.length === 0) {
    list.innerHTML = `<div class="card" style="text-align: center; color: var(--text-dim);">No subject study notes available.</div>`;
    return;
  }

  filteredNotes.forEach(note => {
    const sub = subjects.find(s => s.subject_id === note.subject_id);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '15px';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <span class="edition-badge">${sub ? sub.subject_name : 'Subject'}</span>
          <h3 style="margin: 8px 0 4px 0;">${note.title}</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem;">${note.description}</p>
        </div>
        <a href="#" onclick="alert('Downloading: ${note.file_url}')" class="header-action-btn" style="text-decoration: none;">📥 Download PDF</a>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 10px;">Uploaded: ${note.created_at}</div>
    `;
    list.appendChild(card);
  });
}

// --- TAB: ATTENDANCE RENDERER ---

function renderAttendanceTab() {
  const container = document.getElementById('attendance-content-container');
  if (!container) return;

  const attendance = dbGet('attendance');
  const subjects = dbGet('subjects');

  if (appState.role === 'student') {
    const myLogs = attendance.filter(a => a.student_id === appState.currentUser.student_id);
    let html = `
      <div class="card">
        <h3>My Attendance Log</h3>
        <div class="table-container" style="margin-top: 15px;">
          <table class="custom-table">
            <thead>
              <tr><th>Date</th><th>Subject</th><th>Status</th></tr>
            </thead>
            <tbody>
    `;

    if (myLogs.length === 0) {
      html += `<tr><td colspan="3" style="text-align: center;">No attendance records found.</td></tr>`;
    } else {
      myLogs.forEach(log => {
        const sub = subjects.find(s => s.subject_id === log.subject_id);
        const statusClass = log.status.toLowerCase() === 'present' ? 'present' : 'absent';
        html += `
          <tr>
            <td>${log.date}</td>
            <td>${sub ? sub.subject_name : 'General'}</td>
            <td><span class="badge-status ${statusClass}">${log.status}</span></td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
  } else {
    container.innerHTML = `<div class="card"><p>Teachers can select "My Students" tab to mark individual attendance logs.</p></div>`;
  }
}

// --- TAB: MARKS RENDERER ---

function renderMarksTab() {
  const container = document.getElementById('marks-content-container');
  if (!container) return;

  const marks = dbGet('marks');
  const subjects = dbGet('subjects');

  if (appState.role === 'student') {
    const myMarks = marks.filter(m => m.student_id === appState.currentUser.student_id);
    let html = `
      <div class="card">
        <h3>Academic Assessment Scorecard</h3>
        <div class="table-container" style="margin-top: 15px;">
          <table class="custom-table">
            <thead>
              <tr><th>Subject</th><th>Assessment Type</th><th>Marks Obtained</th><th>Grade</th></tr>
            </thead>
            <tbody>
    `;

    if (myMarks.length === 0) {
      html += `<tr><td colspan="4" style="text-align: center;">No marks records logged.</td></tr>`;
    } else {
      myMarks.forEach(m => {
        const sub = subjects.find(s => s.subject_id === m.subject_id);
        html += `
          <tr>
            <td><b>${sub ? sub.subject_name : 'Subject'}</b></td>
            <td>${m.exam_type}</td>
            <td>${m.marks} / ${m.maximum_marks}</td>
            <td><span class="edition-badge">${m.grade}</span></td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
  } else {
    container.innerHTML = `<div class="card"><p>Faculty grade sheets available under management view.</p></div>`;
  }
}

// --- TAB: ACHIEVEMENTS RENDERER ---

function renderAchievementsTab() {
  const container = document.getElementById('achievements-list-container');
  if (!container) return;
  container.innerHTML = '';

  const achs = dbGet('achievements');
  let filtered = achs;

  if (appState.role === 'student') {
    filtered = achs.filter(a => a.student_id === appState.currentUser.student_id);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-dim);">No achievement badges logged yet.</div>`;
    return;
  }

  filtered.forEach(ach => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '15px';
    card.innerHTML = `
      <div style="display: flex; gap: 15px; align-items: center;">
        <div style="font-size: 2.5rem;">🏆</div>
        <div>
          <span class="edition-badge">${ach.category}</span>
          <h3 style="margin: 4px 0;">${ach.title}</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem;">${ach.description}</p>
          <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 6px;">Awarded Date: ${ach.date}</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// --- TAB: TIMETABLE RENDERER ---

function renderTimetableTab() {
  const container = document.getElementById('timetable-grid-container');
  if (!container) return;

  const timetable = dbGet('timetable');
  const subjects = dbGet('subjects');
  const teachers = dbGet('teachers');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  let html = `<div class="card"><div class="table-container"><table class="custom-table"><thead><tr><th>Day</th><th>Schedule Slots</th></tr></thead><tbody>`;

  days.forEach(day => {
    let slots = timetable.filter(t => t.institution_type === appState.institution && t.day === day);
    if (appState.role === 'student') {
      slots = slots.filter(t => t.class_id === appState.currentUser.class_id);
    } else if (appState.role === 'teacher') {
      slots = slots.filter(t => t.teacher_id === appState.currentUser.teacher_id);
    }

    slots.sort((a, b) => a.start_time.localeCompare(b.start_time));

    let slotStr = slots.map(s => {
      const sub = subjects.find(sb => sb.subject_id === s.subject_id);
      return `<div style="margin-bottom: 6px;"><b>${s.start_time}-${s.end_time}:</b> ${sub ? sub.subject_name : 'Class'} (${s.room})</div>`;
    }).join('');

    html += `
      <tr>
        <td><b>${day}</b></td>
        <td>${slotStr || '<span style="color:var(--text-dim);">No Sessions</span>'}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}

// --- TAB: EXAM TIMETABLE RENDERER ---

function renderExamsTab() {
  const container = document.getElementById('exams-list-container');
  if (!container) return;
  container.innerHTML = '';

  const exams = dbGet('exams').filter(e => e.institution_type === appState.institution);
  const subjects = dbGet('subjects');

  if (exams.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-dim);">No examination timetables published.</div>`;
    return;
  }

  exams.forEach(ex => {
    const sub = subjects.find(s => s.subject_id === ex.subject_id);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '15px';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <span class="edition-badge" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-amber);">${ex.exam_type}</span>
          <h3 style="margin: 8px 0 4px 0;">${ex.exam_name} - ${sub ? sub.subject_name : ''}</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem;">📅 <b>Date:</b> ${ex.date} | ⏰ <b>Time:</b> ${ex.start_time} - ${ex.end_time}</p>
          <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">📍 <b>Venue:</b> ${ex.examination_center} (${ex.examination_hall})</p>
        </div>
      </div>
      <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-top: 10px; font-size: 0.8rem; color: var(--text-dim);">
        ⚠️ <b>Instructions:</b> ${ex.instructions}
      </div>
    `;
    container.appendChild(card);
  });
}

// --- TAB: EXAM CENTERS RENDERER ---

function renderCentersTab() {
  const container = document.getElementById('centers-list-container');
  if (!container) return;
  container.innerHTML = '';

  const centers = dbGet('examination_centers').filter(c => c.institution_type === appState.institution);

  centers.forEach(c => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '15px';
    card.innerHTML = `
      <h3>🏛️ ${c.center_name}</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 4px;">${c.center_address}</p>
      <div style="display: flex; gap: 15px; margin-top: 12px; font-size: 0.85rem;">
        <div><b>Building:</b> ${c.building_name}</div>
        <div><b>Hall/Room:</b> ${c.hall_number}</div>
        <div><b>Seating Capacity:</b> ${c.capacity}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

// --- TAB: CLASSROOM & LIVE VIDEO STREAMING ---

function renderClassroomTab() {
  const container = document.getElementById('classroom-interface-container');
  if (!container) return;

  const teacherControls = appState.role === 'teacher' ? `
    <button class="header-action-btn" style="background: var(--accent-green); color: white;" onclick="startMeetingSession()">Start Live Class</button>
    <button class="header-action-btn" style="background: var(--accent-red); color: white;" onclick="endMeetingSession()">End Live Class</button>
  ` : '';

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
      <div class="card" style="position: relative; background: #000; min-height: 380px; display: flex; align-items: center; justify-content: center; border-radius: var(--border-radius); overflow: hidden;">
        <video id="classroom-video" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
        
        <!-- AI Face Box Simulation Overlay -->
        <div id="ai-face-box" class="ai-face-box" style="display: none; top: 20%; left: 35%; width: 30%; height: 45%;"></div>
        
        <div id="ai-hud-overlay" class="ai-overlay" style="display: none;">
          <div><b>🤖 AI Vision Monitor Active</b></div>
          <div id="ai-status-text">Status: Attentive</div>
          <div id="ai-confidence-text">Confidence: 94%</div>
        </div>

        <div style="position: absolute; bottom: 15px; display: flex; gap: 10px; background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 30px;">
          <button class="header-action-btn" onclick="toggleCamera()">📹 Toggle Cam</button>
          <button class="header-action-btn" onclick="toggleMic()">🎙️ Toggle Mic</button>
          ${teacherControls}
        </div>
      </div>

      <div class="card" style="display: flex; flex-direction: column; height: 380px;">
        <h4 style="margin-bottom: 10px;">Class Live Chat</h4>
        <div id="chat-messages-box" style="flex: 1; overflow-y: auto; background: var(--bg-dark); padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 10px;">
          <div style="color: var(--text-dim);">System: Connected to class session.</div>
        </div>
        <div style="display: flex; gap: 5px;">
          <input type="text" id="chat-input" class="form-input" placeholder="Type question..." onkeypress="if(event.key==='Enter') sendChatMessage()">
          <button class="header-action-btn" onclick="sendChatMessage()">Send</button>
        </div>
      </div>
    </div>
  `;

  startCameraStream();
}

function startCameraStream() {
  const video = document.getElementById('classroom-video');
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        if (video) video.srcObject = stream;
        appState.streamActive = true;
        initAIAttentionTracking();
      })
      .catch(err => {
        console.warn("Camera hardware access denied or not present. Running fallback mode.", err);
      });
  }
}

function toggleCamera() {
  appState.cameraActive = !appState.cameraActive;
  const video = document.getElementById('classroom-video');
  if (video && video.srcObject) {
    video.srcObject.getVideoTracks().forEach(t => t.enabled = appState.cameraActive);
  }
}

function toggleMic() {
  appState.micActive = !appState.micActive;
  const video = document.getElementById('classroom-video');
  if (video && video.srcObject) {
    video.srcObject.getAudioTracks().forEach(t => t.enabled = appState.micActive);
  }
}

function initAIAttentionTracking() {
  const hud = document.getElementById('ai-hud-overlay');
  const box = document.getElementById('ai-face-box');
  if (!hud || !box) return;

  hud.style.display = 'flex';
  box.style.display = 'block';

  if (appState.aiObservationTimer) clearInterval(appState.aiObservationTimer);

  appState.aiObservationTimer = setInterval(() => {
    const isDistracted = Math.random() < 0.25; // 25% chance of simulated distraction event
    const statusText = document.getElementById('ai-status-text');
    const confText = document.getElementById('ai-confidence-text');

    if (isDistracted) {
      box.className = 'ai-face-box warning';
      hud.className = 'ai-overlay warning';
      if (statusText) statusText.textContent = 'Status: Looking Away / Distracted';
      if (confText) confText.textContent = `Confidence: ${(85 + Math.random() * 10).toFixed(0)}%`;

      // If student, log observation automatically
      if (appState.role === 'student') {
        dbInsert('ai_attention_observations', {
          meeting_id: appState.activeMeeting ? appState.activeMeeting.meeting_id : 1,
          student_id: appState.currentUser.student_id,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          observation_type: 'looking_away',
          confidence_score: 0.89,
          review_status: 'pending'
        });
      }
    } else {
      box.className = 'ai-face-box';
      hud.className = 'ai-overlay';
      if (statusText) statusText.textContent = 'Status: Attentive';
      if (confText) confText.textContent = `Confidence: ${(90 + Math.random() * 8).toFixed(0)}%`;
    }
  }, 5000);
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const box = document.getElementById('chat-messages-box');
  if (!input || !input.value.trim()) return;

  const msg = document.createElement('div');
  msg.style.marginBottom = '6px';
  msg.innerHTML = `<b>${appState.currentUser.name}:</b> ${input.value.trim()}`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
  input.value = '';
}

function startMeetingSession() {
  alert('Live Session Initialized for class.');
}

function endMeetingSession() {
  alert('Live Session Ended.');
}

// --- TAB: AI REPORTS RENDERER (TEACHERS) ---

function renderAIReportsTab() {
  const container = document.getElementById('ai-reports-container');
  if (!container) return;

  const obs = dbGet('ai_attention_observations');
  const students = dbGet('students');

  let html = `
    <div class="card">
      <h3>🤖 AI Attentiveness Observation Logs</h3>
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 15px;">Automated posture & visual focus markers recorded during live online sessions.</p>
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr><th>Timestamp</th><th>Student Name</th><th>Observation Type</th><th>Confidence</th><th>Status</th></tr>
          </thead>
          <tbody>
  `;

  if (obs.length === 0) {
    html += `<tr><td colspan="5" style="text-align: center;">No attention anomalies detected.</td></tr>`;
  } else {
    obs.forEach(o => {
      const st = students.find(s => s.student_id === o.student_id);
      html += `
        <tr>
          <td>${o.timestamp}</td>
          <td><b>${st ? st.name : 'Student'}</b></td>
          <td><span class="badge-status absent">${o.observation_type}</span></td>
          <td>${(o.confidence_score * 100).toFixed(0)}%</td>
          <td><span class="edition-badge">${o.review_status}</span></td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}

// --- TAB: NOTIFICATIONS ---

function checkNotificationsCount() {
  const notes = dbGet('notifications').filter(n => n.user_id === appState.currentUser.user_id && !n.is_read);
  const badge = document.getElementById('notification-badge-dot');
  if (badge) badge.style.display = notes.length > 0 ? 'block' : 'none';
}

function renderNotificationsTab() {
  const container = document.getElementById('notifications-list-container');
  if (!container) return;
  container.innerHTML = '';

  const notes = dbGet('notifications').filter(n => n.user_id === appState.currentUser.user_id);

  if (notes.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-dim);">No alerts or notifications.</div>`;
    return;
  }

  notes.forEach(n => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div style="font-weight: 600; color: var(--accent-cyan);">${n.title}</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${n.message}</div>
      <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 6px;">${n.created_at}</div>
    `;
    container.appendChild(card);
  });
}

// --- TAB: ADMIN PANEL ---

// Show/hide the school-only vs college-only fields on the admin
// "provision account" form, and adjust the ID field label to match
// the selected role. Bound to the role <select>'s onchange in index.html.
function adjustAdminFormFields() {
  const roleSelect = document.getElementById('admin-user-role');
  const idLabel = document.getElementById('admin-id-label');
  const schoolFields = document.getElementById('admin-school-fields');
  const collegeFields = document.getElementById('admin-college-fields');
  if (!roleSelect || !idLabel || !schoolFields || !collegeFields) return;

  const role = roleSelect.value;

  if (role === 'teacher') {
    idLabel.textContent = 'Staff ID';
    schoolFields.style.display = 'none';
    collegeFields.style.display = 'none';
    return;
  }

  // role === 'student'
  if (appState.institution === 'college') {
    idLabel.textContent = 'Register Number / Roll Number';
    schoolFields.style.display = 'none';
    collegeFields.style.display = 'block';
  } else {
    idLabel.textContent = 'Roll Number / Admission Number';
    schoolFields.style.display = 'block';
    collegeFields.style.display = 'none';
  }
}

// Handles the "Provision Account" form submit. Sends the new user straight
// to the live backend (POST /api/admin/users), which inserts it into the
// real database (SQLite or PostgreSQL — see database.js). Once this
// succeeds, the new student/teacher can immediately log in for real,
// because login also checks that same database.
async function adminAddUser(event) {
  event.preventDefault();

  const role = document.getElementById('admin-user-role').value;
  const payload = {
    name: document.getElementById('admin-user-name').value.trim(),
    email: document.getElementById('admin-user-email').value.trim(),
    role,
    identifier: document.getElementById('admin-user-id').value.trim(),
    password: document.getElementById('admin-user-password').value,
    class_id: null,
    department: null,
    course: null,
    year: null,
    semester: null
  };

  if (appState.institution === 'school' || role === 'student') {
    const classField = document.getElementById('admin-school-class');
    payload.class_id = classField ? classField.value.trim() || null : null;
  }

  if (appState.institution === 'college' && role === 'student') {
    const deptField = document.getElementById('admin-college-dept');
    const courseField = document.getElementById('admin-college-course');
    const yearField = document.getElementById('admin-college-year');
    const semField = document.getElementById('admin-college-sem');
    payload.department = deptField ? deptField.value.trim() || null : null;
    payload.course = courseField ? courseField.value.trim() || null : null;
    payload.year = yearField ? yearField.value.trim() || null : null;
    payload.semester = semField ? semField.value.trim() || null : null;
  }

  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    await apiRequest('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    alert(`✅ ${payload.name} was created and stored in the database. They can log in immediately.`);
    event.target.reset();
    adjustAdminFormFields();
    renderAdminTab(); // refresh the live list from the backend
  } catch (err) {
    alert(`❌ Could not create account: ${err.message}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function adminAddSubject(event) {
  event.preventDefault();

  const payload = {
    subject_name: document.getElementById('admin-sub-name').value.trim(),
    subject_code: document.getElementById('admin-sub-code').value.trim(),
    teacher_id: document.getElementById('admin-sub-teacher').value.trim(),
    class_id: document.getElementById('admin-sub-class').value.trim(),
  };

  // if (appState.institution === 'school' && role === 'student') {
  //   const classField = document.getElementById('admin-school-class');
  //   payload.class_id = classField ? classField.value.trim() || null : null;
  // }

  // if (appState.institution === 'college' && role === 'student') {
  //   const deptField = document.getElementById('admin-college-dept');
  //   const courseField = document.getElementById('admin-college-course');
  //   const yearField = document.getElementById('admin-college-year');
  //   const semField = document.getElementById('admin-college-sem');
  //   payload.department = deptField ? deptField.value.trim() || null : null;
  //   payload.course = courseField ? courseField.value.trim() || null : null;
  //   payload.year = yearField ? yearField.value.trim() || null : null;
  //   payload.semester = semField ? semField.value.trim() || null : null;
  // }

  const submitBtn = event.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    await apiRequest('/admin/subjects', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    alert(`✅ ${payload.subject_name} was created and stored in the database. They can log in immediately.`);
    event.target.reset();
    //adjustAdminFormFields();
    renderAdminTab(); // refresh the live list from the backend
  } catch (err) {
    alert(`❌ Could not create account: ${err.message}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Renders the admin user table by fetching the CURRENT list of users
// straight from the backend database — not the localStorage mock — so it
// always reflects what's really stored (including anyone just added above).

async function loadTeachersDropdown() {
  const container = document.getElementById('admin-sub-teacher');
  if (!container) return;
  try {
    const adminTeachers = await apiRequest('/admin/all-teachers');
    let options = '<option>Select Staff </option>';
    adminTeachers.forEach((item) => {
      options += `<option value = "${item.teacher_id}">${item.name} (${item.staff_id})</option>`;
    });
    container.innerHTML = options;

  }
  catch (err) {
    console.log(err);
  }
}

async function renderAdminTab() {
  const container = document.getElementById('admin-panel-container');
  if (!container) return;

  adjustAdminFormFields();
  container.innerHTML = `<div class="card"><p>Loading users from the database…</p></div>`;

  let users;
  try {
    users = await apiRequest('/admin/users');
  } catch (err) {
    container.innerHTML = `
      <div class="card">
        <h3>⚙️ Institution User Control Panel</h3>
        <p style="color:#c0392b; margin-top:10px;">
          ⚠️ Could not load users from the backend: ${err.message}
        </p>
      </div>`;
    return;
  }

  let html = `
    <div class="card">
      <h3>⚙️ Institution User Control Panel</h3>
      <div class="table-container" style="margin-top: 15px;">
        <table class="custom-table">
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr>
          </thead>
          <tbody>
  `;

  users.forEach(u => {
    html += `
      <tr>
        <td><b>${u.identifier}</b></td>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td><span class="edition-badge">${u.role}</span></td>
        <td><span class="badge-status present">${u.status}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}

// --- MODAL UTILITIES ---

function openMarkAttendanceModal(studentId) {
  const st = dbGet('students').find(s => s.student_id === studentId);
  if (!st) return;

  const subjects = dbGet('subjects').filter(s => s.teacher_id === appState.currentUser.teacher_id);
  const sub = subjects[0];

  dbInsert('attendance', {
    student_id: studentId,
    subject_id: sub ? sub.subject_id : 1,
    date: new Date().toISOString().split('T')[0],
    status: 'Present',
    recorded_by: appState.currentUser.teacher_id
  });

  alert(`Attendance logged as PRESENT for ${st.name}`);
  renderMyStudentsTab();
}