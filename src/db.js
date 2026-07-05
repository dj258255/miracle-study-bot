import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? 'data/bot.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS voice_segments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    date       TEXT NOT NULL,
    session    TEXT NOT NULL,
    joined_hm  TEXT NOT NULL,
    left_hm    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_segments_lookup
    ON voice_segments (user_id, date, session);

  CREATE TABLE IF NOT EXISTS attendance (
    user_id    TEXT NOT NULL,
    date       TEXT NOT NULL,
    session    TEXT NOT NULL,
    minutes    INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_recent
    ON attendance (user_id, date);

  CREATE TABLE IF NOT EXISTS finalized_sessions (
    date       TEXT NOT NULL,
    session    TEXT NOT NULL,
    PRIMARY KEY (date, session)
  );

  CREATE TABLE IF NOT EXISTS warnings (
    user_id    TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exemptions (
    user_id    TEXT PRIMARY KEY,
    until_date TEXT NOT NULL,   -- 이 날짜(포함)까지 주간 점검 제외
    granted_by TEXT,
    created_at TEXT
  );
`);

const stmt = {
  openSegment: sqlite.prepare(
    `INSERT INTO voice_segments (user_id, date, session, joined_hm) VALUES (?, ?, ?, ?)`
  ),
  hasOpenSegment: sqlite.prepare(
    `SELECT 1 FROM voice_segments WHERE user_id=? AND date=? AND session=? AND left_hm IS NULL LIMIT 1`
  ),
  closeUserOpenSegments: sqlite.prepare(
    `UPDATE voice_segments SET left_hm=? WHERE user_id=? AND date=? AND session=? AND left_hm IS NULL`
  ),
  closeAllOpenSegments: sqlite.prepare(
    `UPDATE voice_segments SET left_hm=? WHERE date=? AND session=? AND left_hm IS NULL`
  ),
  getAllOpenSegments: sqlite.prepare(
    `SELECT id, date, session, joined_hm FROM voice_segments WHERE left_hm IS NULL`
  ),
  closeSegmentById: sqlite.prepare(`UPDATE voice_segments SET left_hm=? WHERE id=?`),
  countUserSessionSegments: sqlite.prepare(
    `SELECT COUNT(*) AS n FROM voice_segments WHERE user_id=? AND date=? AND session=?`
  ),
  getUserSegments: sqlite.prepare(
    `SELECT joined_hm, left_hm FROM voice_segments WHERE user_id=? AND date=? AND session=?`
  ),
  getSessionUsers: sqlite.prepare(
    `SELECT DISTINCT user_id FROM voice_segments WHERE date=? AND session=?`
  ),
  getLastLeftHm: sqlite.prepare(
    `SELECT MAX(left_hm) AS hm FROM voice_segments WHERE user_id=? AND date=? AND session=? AND left_hm IS NOT NULL`
  ),

  insertAttendance: sqlite.prepare(
    `INSERT OR IGNORE INTO attendance (user_id, date, session, minutes) VALUES (?, ?, ?, ?)`
  ),
  hasAttendanceOnDate: sqlite.prepare(
    `SELECT 1 FROM attendance WHERE user_id=? AND date=? LIMIT 1`
  ),
  countAttendanceSince: sqlite.prepare(
    `SELECT COUNT(*) AS n FROM attendance WHERE user_id=? AND date>=?`
  ),

  isFinalized: sqlite.prepare(`SELECT 1 FROM finalized_sessions WHERE date=? AND session=? LIMIT 1`),
  markFinalized: sqlite.prepare(
    `INSERT OR IGNORE INTO finalized_sessions (date, session) VALUES (?, ?)`
  ),
  unfinalizedWithSegments: sqlite.prepare(
    `SELECT DISTINCT v.date, v.session FROM voice_segments v
     WHERE NOT EXISTS (
       SELECT 1 FROM finalized_sessions f WHERE f.date=v.date AND f.session=v.session
     )`
  ),

  getWarnings: sqlite.prepare(`SELECT count FROM warnings WHERE user_id=?`),
  bumpWarning: sqlite.prepare(
    `INSERT INTO warnings (user_id, count, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(user_id) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
     RETURNING count`
  ),
  setWarnings: sqlite.prepare(
    `INSERT INTO warnings (user_id, count, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`
  ),

  setExemption: sqlite.prepare(
    `INSERT INTO exemptions (user_id, until_date, granted_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       until_date = excluded.until_date, granted_by = excluded.granted_by, created_at = excluded.created_at`
  ),
  clearExemption: sqlite.prepare(`DELETE FROM exemptions WHERE user_id=?`),
  getExemption: sqlite.prepare(`SELECT until_date FROM exemptions WHERE user_id=?`),
};

export const db = {
  openSegment: (user, date, session, joinedHm) =>
    stmt.openSegment.run(user, date, session, joinedHm),
  hasOpenSegment: (user, date, session) =>
    !!stmt.hasOpenSegment.get(user, date, session),
  closeUserOpenSegments: (user, date, session, leftHm) =>
    stmt.closeUserOpenSegments.run(leftHm, user, date, session),
  closeAllOpenSegments: (date, session, leftHm) =>
    stmt.closeAllOpenSegments.run(leftHm, date, session),
  getAllOpenSegments: () => stmt.getAllOpenSegments.all(),
  closeSegmentById: (id, leftHm) => stmt.closeSegmentById.run(leftHm, id),
  countUserSessionSegments: (user, date, session) =>
    stmt.countUserSessionSegments.get(user, date, session).n,
  getUserSegments: (user, date, session) => stmt.getUserSegments.all(user, date, session),
  getSessionUsers: (date, session) =>
    stmt.getSessionUsers.all(date, session).map((r) => r.user_id),
  getLastLeftHm: (user, date, session) =>
    stmt.getLastLeftHm.get(user, date, session)?.hm ?? null,

  insertAttendance: (user, date, session, minutes) =>
    stmt.insertAttendance.run(user, date, session, minutes),
  hasAttendanceOnDate: (user, date) => !!stmt.hasAttendanceOnDate.get(user, date),
  countAttendanceSince: (user, sinceDate) =>
    stmt.countAttendanceSince.get(user, sinceDate).n,

  isFinalized: (date, session) => !!stmt.isFinalized.get(date, session),
  markFinalized: (date, session) => stmt.markFinalized.run(date, session),
  unfinalizedWithSegments: () => stmt.unfinalizedWithSegments.all(),

  getWarnings: (user) => stmt.getWarnings.get(user)?.count ?? 0,
  bumpWarning: (user, nowIso) => stmt.bumpWarning.get(user, nowIso).count,
  setWarnings: (user, count, nowIso) => stmt.setWarnings.run(user, count, nowIso),

  setExemption: (user, until, by, nowIso) => stmt.setExemption.run(user, until, by, nowIso),
  clearExemption: (user) => stmt.clearExemption.run(user),
  getExemption: (user) => stmt.getExemption.get(user)?.until_date ?? null,
};
