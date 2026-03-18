import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dbPath = path.resolve(process.cwd(), 'production_analyst.db');
const db = new Database(dbPath);

// Initialize database schema
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      team_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      client_name TEXT,
      team_leader_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      user_id TEXT,
      target_value INTEGER NOT NULL,
      period TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, user_id, effective_date)
    );

    CREATE TABLE IF NOT EXISTS production_entries (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      client_name TEXT,
      date TEXT NOT NULL,
      production_value INTEGER NOT NULL,
      target_value INTEGER NOT NULL,
      quality TEXT,
      notes TEXT,
      is_locked INTEGER DEFAULT 0,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      module TEXT NOT NULL,
      can_view INTEGER DEFAULT 0,
      can_create INTEGER DEFAULT 0,
      can_edit INTEGER DEFAULT 0,
      can_delete INTEGER DEFAULT 0,
      PRIMARY KEY (role, module)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT DEFAULT 'light',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT,
      reference_id TEXT,
      is_read INTEGER DEFAULT 0,
      is_shown INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec("ALTER TABLE notifications ADD COLUMN is_shown INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE production_entries ADD COLUMN is_locked INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE production_entries ADD COLUMN created_by TEXT");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE user_settings ADD COLUMN theme TEXT DEFAULT 'light'");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE production_entries ADD COLUMN quality TEXT");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE teams ADD COLUMN team_leader_id TEXT");
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec("DROP INDEX IF EXISTS idx_targets_team_date");
    db.exec("CREATE UNIQUE INDEX idx_targets_team_user_date ON targets(IFNULL(team_id, ''), IFNULL(user_id, ''), effective_date)");
  } catch (e) {
    // Index already exists or error
  }

  // Performance Indexes
  try {
    db.exec("CREATE INDEX idx_prod_user ON production_entries(user_id)");
    db.exec("CREATE INDEX idx_prod_team ON production_entries(team_id)");
    db.exec("CREATE INDEX idx_prod_date ON production_entries(date)");
    db.exec("CREATE INDEX idx_prod_created_by ON production_entries(created_by)");
    db.exec("CREATE INDEX idx_users_team ON users(team_id)");
    db.exec("CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read)");
    db.exec("CREATE INDEX idx_notifications_user_shown ON notifications(user_id, is_shown)");
  } catch (e) {
    // Indexes probably already exist
  }

  // Seed default super_admin if not exists
  const superAdminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('superadmin');
  const hashedPassword = bcrypt.hashSync('superadmin123', 10);
  if (!superAdminExists) {
    db.prepare(`
      INSERT INTO users (id, username, full_name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('u0', 'superadmin', 'Super Administrator', 'super@example.com', hashedPassword, 'super_admin', 1);
    
    db.prepare("INSERT INTO user_settings (user_id, theme) VALUES (?, ?)").run('u0', 'light');
  } else {
    // Ensure the password is correct for superadmin
    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hashedPassword, 'superadmin');
  }

  // Seed default admin if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (id, username, full_name, email, password, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('u1', 'admin', 'System Administrator', 'admin@example.com', hashedPassword, 'admin', 1);
    
    db.prepare("INSERT INTO user_settings (user_id, theme) VALUES (?, ?)").run('u1', 'light');
  }

  // Seed default permissions
  const permCount = db.prepare('SELECT COUNT(*) as count FROM role_permissions').get() as { count: number };
  if (permCount.count === 0) {
    const roles = ['super_admin', 'admin', 'hr', 'tl', 'member'];
    const modules = ['dashboard', 'production', 'targets', 'teams', 'users', 'settings'];
    
    for (const role of roles) {
      for (const module of modules) {
        let canView = 0, canCreate = 0, canEdit = 0, canDelete = 0;
        
        if (role === 'super_admin') {
          canView = canCreate = canEdit = canDelete = 1;
        } else if (role === 'admin') {
          canView = 1;
          canCreate = canEdit = canDelete = 1;
        } else if (role === 'tl') {
          if (['dashboard', 'production', 'teams', 'users'].includes(module)) canView = 1;
          if (module === 'production') { canCreate = 1; canEdit = 1; }
        } else if (role === 'member') {
          if (['dashboard', 'production', 'teams', 'users'].includes(module)) canView = 1;
        } else if (role === 'hr') {
          if (['dashboard', 'users', 'teams'].includes(module)) canView = 1;
          if (['users', 'teams'].includes(module)) { canCreate = 1; canEdit = 1; }
        }

        db.prepare(`
          INSERT INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(role, module, canView, canCreate, canEdit, canDelete);
      }
    }
  }

  // Seed default global settings
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (settingsCount.count === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('company_name', 'Production Analyst Pro');
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('notifications_enabled', 'true');
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('unlock_roles', 'super_admin,admin,hr');
  }
}

export default db;
