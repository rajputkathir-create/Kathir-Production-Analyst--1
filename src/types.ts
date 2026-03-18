export type UserRole = 'super_admin' | 'admin' | 'hr' | 'tl' | 'member';

export interface User {
  id: string;
  username: string;
  full_name: string;
  email?: string;
  role: UserRole;
  team_id?: string;
  team_name?: string;
  is_active: boolean;
}

export interface Permission {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface RolePermissions {
  [module: string]: Permission;
}

export interface UserSettings {
  theme: 'light' | 'dark';
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  client_name?: string;
  team_leader_id?: string;
  team_leader_name?: string;
  members?: User[];
  is_active: boolean;
}

export interface ProductionEntry {
  id: string;
  team_id: string;
  team_name: string;
  user_id: string;
  user_name: string;
  client_name?: string;
  date: string;
  production_value: number;
  target_value: number;
  quality?: string;
  notes?: string;
  is_locked: boolean;
}

export interface Target {
  id: string;
  team_id?: string;
  team_name?: string;
  user_id?: string;
  user_name?: string;
  target_value: number;
  period: 'daily' | 'weekly' | 'monthly';
  effective_date: string;
}

export interface DashboardStats {
  totalEntries: number;
  totalProduction: number;
  totalTarget: number;
  averagePerformance: number;
  teamCount: number;
  userCount: number;
}
