// SQLite database for Portal — persists tabs, saved sites, and app state

const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

function getDb() {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'portal.db');
  db = new Database(dbPath);

  // WAL mode for better concurrent read/write performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tabs (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT 'New Tab',
      favicon TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      favicon TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      photo TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO user_profile (id) VALUES (1);
  `);

  // Migration: add is_pinned column if it doesn't exist
  const cols = db.pragma('table_info(tabs)').map(c => c.name);
  if (!cols.includes('is_pinned')) {
    db.exec('ALTER TABLE tabs ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: add group_id column to tabs
  if (!cols.includes('group_id')) {
    db.exec('ALTER TABLE tabs ADD COLUMN group_id INTEGER DEFAULT NULL');
  }

  // Create tab_groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tab_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Group',
      color TEXT NOT NULL DEFAULT '#8b5cf6',
      position INTEGER NOT NULL DEFAULT 0,
      is_collapsed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

// --- Tabs ---

function getAllTabs() {
  return getDb().prepare('SELECT * FROM tabs ORDER BY position ASC').all();
}

function getActiveTabId() {
  const row = getDb().prepare('SELECT id FROM tabs WHERE is_active = 1 LIMIT 1').get();
  return row ? row.id : null;
}

function createTab({ id, url, title, favicon, position, isActive }) {
  const d = getDb();
  if (isActive) {
    d.prepare('UPDATE tabs SET is_active = 0').run();
  }
  d.prepare(
    'INSERT INTO tabs (id, url, title, favicon, position, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, url || '', title || 'New Tab', favicon || null, position, isActive ? 1 : 0);
}

function updateTab(id, fields) {
  const d = getDb();
  const sets = [];
  const values = [];

  if ('url' in fields) { sets.push('url = ?'); values.push(fields.url); }
  if ('title' in fields) { sets.push('title = ?'); values.push(fields.title); }
  if ('favicon' in fields) { sets.push('favicon = ?'); values.push(fields.favicon); }
  if ('position' in fields) { sets.push('position = ?'); values.push(fields.position); }
  if ('isPinned' in fields) { sets.push('is_pinned = ?'); values.push(fields.isPinned ? 1 : 0); }
  if ('groupId' in fields) { sets.push('group_id = ?'); values.push(fields.groupId); }
  if ('isActive' in fields) {
    if (fields.isActive) {
      d.prepare('UPDATE tabs SET is_active = 0').run();
    }
    sets.push('is_active = ?');
    values.push(fields.isActive ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  d.prepare(`UPDATE tabs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function deleteTab(id) {
  getDb().prepare('DELETE FROM tabs WHERE id = ?').run(id);
}

function deleteAllTabs() {
  getDb().prepare('DELETE FROM tabs').run();
}

// --- Saved Sites ---

function getAllSaved() {
  return getDb().prepare('SELECT * FROM saved_sites ORDER BY position ASC').all();
}

function createSaved({ url, title, favicon, position }) {
  try {
    getDb().prepare(
      'INSERT INTO saved_sites (url, title, favicon, position) VALUES (?, ?, ?, ?)'
    ).run(url, title || '', favicon || null, position || 0);
    return true;
  } catch (e) {
    // UNIQUE constraint — already saved
    return false;
  }
}

function deleteSaved(id) {
  getDb().prepare('DELETE FROM saved_sites WHERE id = ?').run(id);
}

function deleteSavedByUrl(url) {
  getDb().prepare('DELETE FROM saved_sites WHERE url = ?').run(url);
}

function getNextTabId() {
  const row = getDb().prepare('SELECT MAX(id) as maxId FROM tabs').get();
  return (row.maxId || 0) + 1;
}

// --- User Profile ---

function getProfile() {
  return getDb().prepare('SELECT * FROM user_profile WHERE id = 1').get();
}

function updateProfile(fields) {
  const d = getDb();
  const sets = [];
  const values = [];

  if ('firstName' in fields) { sets.push('first_name = ?'); values.push(fields.firstName); }
  if ('lastName' in fields) { sets.push('last_name = ?'); values.push(fields.lastName); }
  if ('email' in fields) { sets.push('email = ?'); values.push(fields.email); }
  if ('photo' in fields) { sets.push('photo = ?'); values.push(fields.photo); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(1);

  d.prepare(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// --- Tab Groups ---

function getAllGroups() {
  return getDb().prepare('SELECT * FROM tab_groups ORDER BY position ASC').all();
}

function createGroup({ name, color, position }) {
  const result = getDb().prepare(
    'INSERT INTO tab_groups (name, color, position) VALUES (?, ?, ?)'
  ).run(name || 'New Group', color || '#8b5cf6', position || 0);
  return result.lastInsertRowid;
}

function updateGroup(id, fields) {
  const d = getDb();
  const sets = [];
  const values = [];

  if ('name' in fields) { sets.push('name = ?'); values.push(fields.name); }
  if ('color' in fields) { sets.push('color = ?'); values.push(fields.color); }
  if ('position' in fields) { sets.push('position = ?'); values.push(fields.position); }
  if ('isCollapsed' in fields) { sets.push('is_collapsed = ?'); values.push(fields.isCollapsed ? 1 : 0); }

  if (sets.length === 0) return;
  values.push(id);
  d.prepare(`UPDATE tab_groups SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function deleteGroup(id) {
  const d = getDb();
  // Ungroup all tabs in this group
  d.prepare('UPDATE tabs SET group_id = NULL WHERE group_id = ?').run(id);
  d.prepare('DELETE FROM tab_groups WHERE id = ?').run(id);
}

function reorderPinnedTabs(orderedIds) {
  const d = getDb();
  const stmt = d.prepare('UPDATE tabs SET position = ? WHERE id = ?');
  const tx = d.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id));
  });
  tx();
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getAllTabs,
  getActiveTabId,
  createTab,
  updateTab,
  deleteTab,
  deleteAllTabs,
  getAllSaved,
  createSaved,
  deleteSaved,
  deleteSavedByUrl,
  getNextTabId,
  getProfile,
  updateProfile,
  reorderPinnedTabs,
  getAllGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  close,
};
