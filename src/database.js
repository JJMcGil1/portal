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
  close,
};
