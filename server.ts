import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import db, { initDb } from "./src/db.ts";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "production_analyst_secret_key_123";

async function startServer() {
  initDb();
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // SSE Clients
  const sseClients = new Map<string, Set<any>>();

  const broadcastEvent = (event: string, data: any = {}, userId?: string) => {
    if (userId) {
      const userClients = sseClients.get(userId);
      if (userClients) {
        userClients.forEach(client => {
          client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
      }
    } else {
      sseClients.forEach(userClients => {
        userClients.forEach(client => {
          client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        });
      });
    }
  };

  app.get('/api/events', (req: any, res: any) => {
    const token = req.query.token;
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return res.sendStatus(403);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const userId = decoded.id;
      if (!sseClients.has(userId)) {
        sseClients.set(userId, new Set());
      }
      sseClients.get(userId)!.add(res);

      req.on('close', () => {
        const userClients = sseClients.get(userId);
        if (userClients) {
          userClients.delete(res);
          if (userClients.size === 0) {
            sseClients.delete(userId);
          }
        }
      });
    });
  });

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) return res.sendStatus(403);
      
      // Fetch latest user info from DB to ensure team_id and other fields are current
      const user = db.prepare('SELECT id, username, full_name, role, team_id, is_active FROM users WHERE id = ?').get(decoded.id) as any;
      
      if (!user) return res.sendStatus(403);
      if (!user.is_active) return res.status(403).json({ message: "Account deactivated" });
      
      req.user = user;
      next();
    });
  };

  const checkAdmin = (req: any, res: any, next: any) => {
    if (req.user && (req.user.role === 'super_admin' || req.user.role === 'admin')) {
      next();
    } else {
      res.status(403).json({ message: "Admin access required" });
    }
  };

  const checkPermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete') => {
    return (req: any, res: any, next: any) => {
      if (req.user.role === 'super_admin') return next();

      const permission = db.prepare(`
        SELECT can_view, can_create, can_edit, can_delete 
        FROM role_permissions 
        WHERE role = ? AND module = ?
      `).get(req.user.role, module) as any;

      if (!permission) return res.status(403).json({ message: "Permission denied" });

      const hasPermission = 
        (action === 'view' && permission.can_view) ||
        (action === 'create' && permission.can_create) ||
        (action === 'edit' && permission.can_edit) ||
        (action === 'delete' && permission.can_delete);

      if (!hasPermission) {
        return res.status(403).json({ message: `Permission denied for ${action} on ${module}` });
      }
      next();
    };
  };

  // --- Helper Functions ---
  // Migration for notifications table
  try {
    db.prepare("ALTER TABLE notifications ADD COLUMN type TEXT").run();
    db.prepare("ALTER TABLE notifications ADD COLUMN reference_id TEXT").run();
  } catch (e) {
    // Columns probably already exist
  }

  const createGlobalNotification = (title: string, message: string, type?: string, reference_id?: string) => {
    const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all() as any[];
    const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction((usersList) => {
      for (const user of usersList) {
        stmt.run(uuidv4(), user.id, title, message, type || null, reference_id || null);
      }
    });
    transaction(users);
    broadcastEvent('notifications-updated');
  };

  // --- API Routes ---

  // Auth
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.is_active) {
      return res.status(403).json({ message: "Account deactivated" });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    
    const permissions = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(user.role) as any[];
    const permissionsMap: any = {};
    permissions.forEach(p => {
      permissionsMap[p.module] = {
        can_view: !!p.can_view,
        can_create: !!p.can_create,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete
      };
    });

    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(user.id) as any || { theme: 'light' };

    res.json({ 
      token, 
      user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, team_id: user.team_id },
      permissions: permissionsMap,
      settings
    });
  });

  // Role Permissions
  app.get("/api/me/permissions", authenticateToken, (req: any, res) => {
    if (req.user.role === 'super_admin') {
      return res.json({ super_admin: true });
    }
    const permissions = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(req.user.role) as any[];
    const permissionsMap: any = {};
    permissions.forEach(p => {
      permissionsMap[p.module] = {
        can_view: !!p.can_view,
        can_create: !!p.can_create,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete
      };
    });
    res.json(permissionsMap);
  });

  app.get("/api/permissions", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canView = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_view);

    if (!canView) {
      return res.status(403).json({ message: "Unauthorized. Settings access required." });
    }
    
    const roles = ['admin', 'hr', 'tl', 'member'];
    const placeholders = roles.map(() => '?').join(',');
    const permissions = db.prepare(`SELECT * FROM role_permissions WHERE role IN (${placeholders})`).all(...roles);
    res.json(permissions);
  });

  app.post("/api/permissions", authenticateToken, (req: any, res) => {
    const { role, module, can_view, can_create, can_edit, can_delete } = req.body;
    
    // Authorization check - ONLY SuperAdmin
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "Unauthorized. SuperAdmin access required." });
    }

    db.prepare(`
      INSERT OR REPLACE INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(role, module, can_view ? 1 : 0, can_create ? 1 : 0, can_edit ? 1 : 0, can_delete ? 1 : 0);

    broadcastEvent('permissions-updated');
    res.json({ success: true });
  });

  // Global Settings
  app.get("/api/global-settings", authenticateToken, (req: any, res) => {
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const settingsMap: any = {};
    settings.forEach(s => {
      settingsMap[s.key] = s.value;
    });
    res.json(settingsMap);
  });

  app.post("/api/global-settings", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canEdit = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_edit);
    const canDelete = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_delete);
    const canView = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_view) || ['hr', 'tl', 'member'].includes(req.user.role);

    if (!canEdit && !canDelete && !canView) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const { company_name, company_logo, notifications_enabled, unlock_roles, theme_color } = req.body;
    
    // Only users with delete permission can change theme_color
    if (theme_color !== undefined && !canDelete) {
      return res.status(403).json({ message: "Delete permission required to change the theme color" });
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction(() => {
      if (company_name !== undefined && canEdit) stmt.run('company_name', company_name);
      if (company_logo !== undefined && canEdit) stmt.run('company_logo', company_logo);
      if (notifications_enabled !== undefined && canView) stmt.run('notifications_enabled', notifications_enabled.toString());
      if (unlock_roles !== undefined && canEdit) stmt.run('unlock_roles', unlock_roles);
      if (theme_color !== undefined && canDelete) stmt.run('theme_color', theme_color);
    });
    
    transaction();
    broadcastEvent('global-settings-updated');
    res.json({ success: true });
  });

  app.post("/api/permissions/bulk", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canManage = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_delete);

    if (!canManage) {
      return res.status(403).json({ message: "Unauthorized. Administrative access required." });
    }
    
    const { permissions } = req.body;
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO role_permissions (role, module, can_view, can_create, can_edit, can_delete)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = db.transaction((perms) => {
      // Get current user's permissions to validate they aren't granting more than they have
      const userPerms = db.prepare('SELECT * FROM role_permissions WHERE role = ?').all(req.user.role) as any[];
      const userPermsMap = userPerms.reduce((acc, p) => {
        acc[p.module] = p;
        return acc;
      }, {} as any);

      for (const p of perms) {
        // If not super_admin, check if user has the permission they are trying to grant
        if (req.user.role !== 'super_admin') {
          const uPerm = userPermsMap[p.module] || { can_view: 0, can_create: 0, can_edit: 0, can_delete: 0 };
          if (p.can_view && !uPerm.can_view) p.can_view = 0;
          if (p.can_create && !uPerm.can_create) p.can_create = 0;
          if (p.can_edit && !uPerm.can_edit) p.can_edit = 0;
          if (p.can_delete && !uPerm.can_delete) p.can_delete = 0;
        }
        stmt.run(p.role, p.module, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0);
      }
    });
    
    try {
      transaction(permissions);
      broadcastEvent('permissions-updated');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/change-password", authenticateToken, (req: any, res) => {
    const perms = db.prepare('SELECT * FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'settings') as any;
    const canCreate = req.user.role === 'super_admin' || req.user.role === 'admin' || (perms && perms.can_create);
    if (!canCreate) {
      return res.status(403).json({ message: "Create permission required to change password" });
    }
    const { newPassword } = req.body;

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);
    
    res.json({ success: true });
  });

  // Notifications
  app.get("/api/notifications", authenticateToken, (req: any, res) => {
    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json(notifications);
  });

  app.delete("/api/notifications", authenticateToken, (req: any, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/:id/read", authenticateToken, (req: any, res) => {
    db.prepare('UPDATE notifications SET is_read = 1, is_shown = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  app.post("/api/notifications/:id/shown", authenticateToken, (req: any, res) => {
    db.prepare('UPDATE notifications SET is_shown = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    broadcastEvent('notifications-updated', {}, req.user.id);
    res.json({ success: true });
  });

  // User Settings
  app.get("/api/user-settings", authenticateToken, (req: any, res) => {
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
    res.json(settings || { theme: 'light' });
  });

  app.post("/api/user-settings", authenticateToken, (req: any, res) => {
    const { theme } = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO user_settings (user_id, theme)
      VALUES (?, ?)
    `).run(req.user.id, theme);
    res.json({ success: true });
  });

  // Settings (Restricted to SuperAdmin)
  app.get("/api/settings", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "SuperAdmin access required" });
    }
    res.json({
      theme: 'dark',
      notifications: true,
      permissions: {
        admin: ['dashboard', 'users', 'teams', 'production', 'targets', 'settings'],
        tl: ['production'],
        member: ['production_view']
      }
    });
  });

  app.post("/api/settings", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "SuperAdmin access required" });
    }
    res.json({ success: true });
  });

  // Dashboard Stats
  app.get("/api/dashboard/stats", authenticateToken, checkPermission('dashboard', 'view'), (req: any, res) => {
    const { team_id, user_id, from, to } = req.query;
    
    let entriesQuery = `
      SELECT pe.* FROM production_entries pe
      LEFT JOIN teams t ON pe.team_id = t.id
      LEFT JOIN users u ON pe.user_id = u.id
      WHERE 1=1
    `;
    let entriesParams: any[] = [];

    // Role-based visibility
    if (req.user.role === 'member') {
      entriesQuery += ' AND (pe.team_id = ? OR pe.user_id = ?) AND pe.is_locked = 1';
      entriesParams.push(req.user.team_id, req.user.id);
    } else if (req.user.role === 'tl') {
      entriesQuery += ' AND ((t.team_leader_id = ? AND pe.is_locked = 1) OR pe.created_by = ?)';
      entriesParams.push(req.user.id, req.user.id);
    } else {
      entriesQuery += ' AND (pe.is_locked = 1 OR pe.created_by = ?)';
      entriesParams.push(req.user.id);
    }

    // Additional filters
    if (team_id) {
      entriesQuery += ' AND pe.team_id = ?';
      entriesParams.push(team_id);
    }
    if (user_id) {
      entriesQuery += ' AND pe.user_id = ?';
      entriesParams.push(user_id);
    }
    if (from) {
      entriesQuery += ' AND pe.date >= ?';
      entriesParams.push(from);
    }
    if (to) {
      entriesQuery += ' AND pe.date <= ?';
      entriesParams.push(to);
    }

    try {
      const entries = db.prepare(entriesQuery).all(...entriesParams) as any[];
      
      const teamsCount = db.prepare('SELECT COUNT(*) as count FROM teams WHERE is_active = 1').get() as any;
      const usersCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get() as any;

      const totalProd = entries.reduce((sum, e) => sum + (e.production_value || 0), 0);
      const totalTgt = entries.reduce((sum, e) => sum + (e.target_value || 0), 0);
      const avgPerf = totalTgt > 0 ? (totalProd / totalTgt) * 100 : 0;

      res.json({
        totalEntries: entries.length,
        totalProduction: totalProd,
        totalTarget: totalTgt,
        averagePerformance: avgPerf,
        teamCount: teamsCount?.count || 0,
        userCount: usersCount?.count || 0
      });
    } catch (err) {
      console.error('Error in /api/dashboard/stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Production Entries
  app.get("/api/production", authenticateToken, checkPermission('production', 'view'), (req: any, res) => {
    const { team_id, user_id, from, to, search, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let baseQuery = `
      FROM production_entries pe
      LEFT JOIN teams t ON pe.team_id = t.id
      LEFT JOIN users u ON pe.user_id = u.id
      WHERE 1=1
    `;
    let params: any[] = [];
    
    // Role-based visibility
    if (req.user.role === 'member') {
      baseQuery += ` AND (pe.team_id = ? OR pe.user_id = ?) AND pe.is_locked = 1`;
      params.push(req.user.team_id, req.user.id);
    } else if (req.user.role === 'tl') {
      baseQuery += ` AND ((t.team_leader_id = ? AND pe.is_locked = 1) OR pe.created_by = ?)`;
      params.push(req.user.id, req.user.id);
    } else {
      baseQuery += ` AND (pe.is_locked = 1 OR pe.created_by = ?)`;
      params.push(req.user.id);
    }

    // Filters
    if (team_id) {
      baseQuery += ` AND pe.team_id = ?`;
      params.push(team_id);
    }
    if (user_id) {
      baseQuery += ` AND pe.user_id = ?`;
      params.push(user_id);
    }
    if (from) {
      baseQuery += ` AND pe.date >= ?`;
      params.push(from);
    }
    if (to) {
      baseQuery += ` AND pe.date <= ?`;
      params.push(to);
    }
    if (search) {
      baseQuery += ` AND (u.full_name LIKE ? OR pe.client_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    try {
      // Get total count for pagination
      const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
      const countResult = db.prepare(countQuery).get(...params) as any;
      const totalCount = countResult?.total || 0;

      // Get paginated data
      const dataQuery = `
        SELECT pe.*, t.name as team_name, u.full_name as user_name 
        ${baseQuery}
        ORDER BY pe.date DESC, pe.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const entries = db.prepare(dataQuery).all(...params, Number(limit), offset) as any[];
      
      const mappedEntries = entries.map(e => ({ ...e, is_locked: !!e.is_locked }));
      
      res.json({
        data: mappedEntries,
        pagination: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit))
        }
      });
    } catch (err) {
      console.error('Error in /api/production:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/production", authenticateToken, checkPermission('production', 'create'), (req: any, res) => {
    let { team_id, user_id, client_name, date, production_value, target_value, quality, notes } = req.body;
    
    // If team_id is missing, try to fetch it from the user's current assignment
    if (!team_id && user_id) {
      const user = db.prepare('SELECT team_id FROM users WHERE id = ?').get(user_id) as any;
      if (user && user.team_id) {
        team_id = user.team_id;
      }
    }

    // Auto-fetch client name from team if not provided or to ensure consistency
    if (!client_name && team_id) {
      const team = db.prepare('SELECT client_name FROM teams WHERE id = ?').get(team_id) as any;
      if (team) client_name = team.client_name || '';
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO production_entries (id, team_id, user_id, client_name, date, production_value, target_value, quality, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, team_id, user_id, client_name, date, production_value, target_value, quality, notes, req.user.id);

    res.status(201).json({ id });
  });

  app.put("/api/production/:id", authenticateToken, checkPermission('production', 'edit'), (req: any, res) => {
    const entry = db.prepare('SELECT is_locked FROM production_entries WHERE id = ?').get(req.params.id) as any;
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    
    if (entry.is_locked && req.user.role !== 'super_admin') {
      return res.status(403).json({ message: "Cannot edit a locked entry. Only Superadmin can unlock." });
    }

    const { production_value, target_value, client_name, quality, notes } = req.body;
    db.prepare(`
      UPDATE production_entries 
      SET production_value = ?, target_value = ?, client_name = ?, quality = ?, notes = ?
      WHERE id = ?
    `).run(production_value, target_value, client_name, quality, notes, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/production/:id", authenticateToken, checkPermission('production', 'delete'), (req, res) => {
    const entry = db.prepare('SELECT is_locked FROM production_entries WHERE id = ?').get(req.params.id) as any;
    if (!entry) {
      return res.status(404).json({ message: "Production entry not found" });
    }
    if (entry.is_locked) {
      return res.status(403).json({ message: "Cannot delete a locked entry" });
    }
    db.prepare('DELETE FROM production_entries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  app.patch("/api/production/:id/toggle-lock", authenticateToken, (req: any, res) => {
    const entry = db.prepare('SELECT is_locked, created_by FROM production_entries WHERE id = ?').get(req.params.id) as any;
    if (!entry) {
      return res.status(404).json({ message: "Production entry not found" });
    }

    const isCurrentlyLocked = !!entry.is_locked;
    const isCreator = entry.created_by === req.user.id;
    
    // If trying to UNLOCK (locked -> unlocked)
    if (isCurrentlyLocked) {
      const unlockSettings = db.prepare('SELECT value FROM settings WHERE key = ?').get('unlock_roles') as any;
      const allowedRoles = unlockSettings ? unlockSettings.value.split(',') : ['super_admin', 'admin', 'hr'];
      
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ message: `Only ${allowedRoles.join(', ')} can unlock entries` });
      }
    } else {
      // If trying to LOCK (unlocked -> locked)
      // Allow if creator OR has edit permission
      const hasEditPerm = req.user.role === 'super_admin' || (db.prepare('SELECT can_edit FROM role_permissions WHERE role = ? AND module = ?').get(req.user.role, 'production') as any)?.can_edit === 1;
      if (!isCreator && !hasEditPerm) {
        return res.status(403).json({ message: "Permission denied to lock this entry" });
      }
    }

    const newLockStatus = isCurrentlyLocked ? 0 : 1;
    db.prepare('UPDATE production_entries SET is_locked = ? WHERE id = ?').run(newLockStatus, req.params.id);
    
    if (!isCurrentlyLocked) {
      // It was unlocked, now it's locked (confirmed)
      const fullEntry = db.prepare(`
        SELECT pe.*, t.name as team_name, u.full_name as user_name 
        FROM production_entries pe 
        JOIN teams t ON pe.team_id = t.id 
        JOIN users u ON pe.user_id = u.id
        WHERE pe.id = ?
      `).get(req.params.id) as any;
      
      if (fullEntry) {
        createGlobalNotification(
          'Production Entry Added',
          `${fullEntry.user_name} added a production entry for ${fullEntry.team_name}.`,
          'production',
          req.params.id
        );
        broadcastEvent('notifications-updated');
      }
    }

    res.json({ success: true, is_locked: !!newLockStatus });
  });

  // Teams
  app.get("/api/teams", authenticateToken, (req: any, res, next) => {
    if (req.user.role === 'member' || req.user.role === 'tl') return next();
    return checkPermission('teams', 'view')(req, res, next);
  }, (req: any, res) => {
    let query = `
      SELECT t.*, u.full_name as team_leader_name 
      FROM teams t 
      LEFT JOIN users u ON t.team_leader_id = u.id
      WHERE t.is_active = 1
    `;
    let params: any[] = [];
    
    if (req.user.role === 'tl') {
      query += ` AND t.team_leader_id = ?`;
      params.push(req.user.id);
    } else if (req.user.role === 'member') {
      query += ` AND (t.id = ? OR t.id = (SELECT team_id FROM users WHERE id = ?))`;
      params.push(req.user.team_id, req.user.id);
    }
    
    const teams = db.prepare(query).all(...params) as any[];
    
    const users = db.prepare('SELECT * FROM users WHERE is_active = 1').all() as any[];
    
    const teamsWithMembers = teams.map(team => ({
      ...team,
      members: users.filter(u => u.team_id === team.id && u.role === 'member')
    }));
    
    res.json(teamsWithMembers);
  });

  app.post("/api/teams", authenticateToken, checkPermission('teams', 'create'), (req, res) => {
    const { name, description, client_name, team_leader_id, member_ids } = req.body;
    const id = uuidv4();
    const transaction = db.transaction(() => {
      db.prepare('INSERT INTO teams (id, name, description, client_name, team_leader_id) VALUES (?, ?, ?, ?, ?)').run(id, name, description, client_name, team_leader_id);
      if (member_ids && member_ids.length > 0) {
        const placeholders = member_ids.map(() => '?').join(',');
        db.prepare(`UPDATE users SET team_id = ? WHERE id IN (${placeholders})`).run(id, ...member_ids);
      }
    });
    transaction();
    broadcastEvent('teams-updated');
    broadcastEvent('users-updated');
    res.status(201).json({ id });
  });

  app.put("/api/teams/:id", authenticateToken, checkPermission('teams', 'edit'), (req, res) => {
    const { name, description, client_name, team_leader_id, member_ids } = req.body;
    const transaction = db.transaction(() => {
      db.prepare('UPDATE teams SET name = ?, description = ?, client_name = ?, team_leader_id = ? WHERE id = ?').run(name, description, client_name, team_leader_id, req.params.id);
      db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(req.params.id);
      if (member_ids && member_ids.length > 0) {
        const placeholders = member_ids.map(() => '?').join(',');
        db.prepare(`UPDATE users SET team_id = ? WHERE id IN (${placeholders})`).run(req.params.id, ...member_ids);
      }
    });
    transaction();
    broadcastEvent('teams-updated');
    broadcastEvent('users-updated');
    res.json({ success: true });
  });

  app.delete("/api/teams/:id", authenticateToken, checkPermission('teams', 'delete'), (req, res) => {
    const result = db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "Team not found" });
    }
    broadcastEvent('teams-updated');
    broadcastEvent('users-updated');
    res.json({ success: true });
  });

  // Users
  app.get("/api/users", authenticateToken, (req: any, res, next) => {
    if (req.user.role === 'member' || req.user.role === 'tl') return next();
    return checkPermission('users', 'view')(req, res, next);
  }, (req: any, res) => {
    let query = `
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.team_id, u.is_active, t.name as team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
    `;
    let params: any[] = [];
    
    if (req.user.role === 'tl') {
      query += ` WHERE t.team_leader_id = ? OR u.id = ?`;
      params.push(req.user.id, req.user.id);
    } else if (req.user.role === 'member') {
      query += ` WHERE u.team_id = ? OR u.id = ?`;
      params.push(req.user.team_id, req.user.id);
    }
    
    const users = db.prepare(query).all(...params);
    res.json(users);
  });

  app.get("/api/my-team", authenticateToken, (req: any, res) => {
    if (req.user.role !== 'tl') {
      return res.status(403).json({ message: "Forbidden" });
    }
    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, u.role, u.team_id, u.is_active, t.name as team_name
      FROM users u
      JOIN teams t ON u.team_id = t.id
      WHERE t.team_leader_id = ? AND u.id != ?
    `).all(req.user.id, req.user.id);
    res.json(users);
  });

  app.post("/api/users", authenticateToken, checkPermission('users', 'create'), (req: any, res) => {
    const { username, full_name, email, role, team_id, password } = req.body;
    
    // Check if username already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const finalTeamId = team_id === '' ? null : team_id;
    
    db.prepare(`
      INSERT INTO users (id, username, full_name, email, role, team_id, password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, username, full_name, email, role, finalTeamId, hashedPassword);

    // Notify TL if assigned to a team
    if (finalTeamId) {
      const team = db.prepare('SELECT name, team_leader_id FROM teams WHERE id = ?').get(finalTeamId) as any;
      if (team && team.team_leader_id) {
        const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(uuidv4(), team.team_leader_id, 'New Team Member', `${full_name} has been assigned to your team: ${team.name}`, 'user', id);
        broadcastEvent('notifications-updated', {}, team.team_leader_id);
      }
    }

    broadcastEvent('users-updated');
    res.status(201).json({ id });
  });

  app.put("/api/users/:id", authenticateToken, checkPermission('users', 'edit'), (req: any, res) => {
    const { full_name, email, role, team_id, is_active, password } = req.body;
    const finalTeamId = team_id === '' ? null : team_id;
    
    const userToEdit = db.prepare('SELECT role, team_id FROM users WHERE id = ?').get(req.params.id) as any;
    if (userToEdit && userToEdit.role === 'super_admin') {
      if (req.user.role !== 'super_admin') {
        return res.status(403).json({ message: "Only SuperAdmin can modify a SuperAdmin account" });
      }
      if (role !== 'super_admin' || is_active === 0 || is_active === false) {
        return res.status(403).json({ message: "Cannot modify SuperAdmin role or deactivate account" });
      }
    }

    // Notify TL if team assignment changed
    if (finalTeamId && finalTeamId !== userToEdit.team_id) {
      const team = db.prepare('SELECT name, team_leader_id FROM teams WHERE id = ?').get(finalTeamId) as any;
      if (team && team.team_leader_id) {
        const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type, reference_id) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(uuidv4(), team.team_leader_id, 'New Team Member', `${full_name} has been assigned to your team: ${team.name}`, 'user', req.params.id);
        broadcastEvent('notifications-updated', {}, team.team_leader_id);
      }
    }

    if (password) {
      if ((req as any).user.role !== 'super_admin' && (req as any).user.role !== 'admin') {
        return res.status(403).json({ message: "Only SuperAdmin and Admin can update passwords" });
      }
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users SET full_name = ?, email = ?, role = ?, team_id = ?, is_active = ?, password = ?
        WHERE id = ?
      `).run(full_name, email, role, finalTeamId, is_active === undefined ? 1 : is_active, hashedPassword, req.params.id);
    } else {
      db.prepare(`
        UPDATE users SET full_name = ?, email = ?, role = ?, team_id = ?, is_active = ?
        WHERE id = ?
      `).run(full_name, email, role, finalTeamId, is_active === undefined ? 1 : is_active, req.params.id);
    }
    broadcastEvent('users-updated');
    res.json({ success: true });
  });

  app.delete("/api/users/:id", authenticateToken, checkPermission('users', 'delete'), (req, res) => {
    const userToDelete = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id) as any;
    if (userToDelete && userToDelete.role === 'super_admin') {
      return res.status(403).json({ message: "Cannot delete SuperAdmin account" });
    }

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    broadcastEvent('users-updated');
    res.json({ success: true });
  });

  // Targets
  app.get("/api/targets", authenticateToken, checkPermission('targets', 'view'), (req: any, res) => {
    let query = `
      SELECT tg.*, t.name as team_name, u.full_name as user_name
      FROM targets tg
      LEFT JOIN teams t ON tg.team_id = t.id
      LEFT JOIN users u ON tg.user_id = u.id
    `;
    const params: any[] = [];

    if (req.user.role === 'member') {
      query += ` WHERE tg.team_id = ?`;
      params.push(req.user.team_id);
    } else if (req.user.role === 'tl') {
      query += ` WHERE t.team_leader_id = ?`;
      params.push(req.user.id);
    }

    const targets = db.prepare(query).all(...params);
    res.json(targets);
  });

  app.post("/api/targets", authenticateToken, checkPermission('targets', 'create'), (req, res) => {
    const { team_id, user_id, target_value, period, effective_date } = req.body;
    if (!team_id && !user_id) return res.status(400).json({ message: "Team or User is required" });
    
    const id = uuidv4();
    try {
      const existing = db.prepare('SELECT id FROM targets WHERE (team_id = ? OR (team_id IS NULL AND ? IS NULL)) AND (user_id = ? OR (user_id IS NULL AND ? IS NULL)) AND effective_date = ?')
        .get(team_id || null, team_id || null, user_id || null, user_id || null, effective_date);
      
      db.prepare(`
        INSERT INTO targets (id, team_id, user_id, target_value, period, effective_date)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(team_id, user_id, effective_date) DO UPDATE SET
          target_value = excluded.target_value,
          period = excluded.period
      `).run(id, team_id || null, user_id || null, target_value, period, effective_date);

      // Trigger Notification
      const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(team_id) as any;
      const teamName = team ? team.name : 'Unknown Team';
      const action = existing ? 'Target Updated' : 'Target Created';
      const targetId = (existing as any)?.id || id;
      const message = existing 
        ? `${(req as any).user.username} updated the target for ${teamName} (Effective: ${effective_date}).`
        : `${(req as any).user.username} set a new target for ${teamName} (Effective: ${effective_date}).`;
      
      createGlobalNotification(action, message, 'target', targetId);

      res.status(201).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/targets/:id", authenticateToken, checkPermission('targets', 'delete'), (req, res) => {
    const result = db.prepare('DELETE FROM targets WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ message: "Target not found" });
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
