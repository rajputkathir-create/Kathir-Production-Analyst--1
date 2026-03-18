import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { User, Team } from '../types';
import { Plus, Edit2, Trash2, Shield, User as UserIcon, Key, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationModal from '../components/ConfirmationModal';

export default function UsersPage() {
  const { token, user: currentUser, permissions } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['users'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    email: '',
    role: 'member' as any,
    team_id: '',
    password: ''
  });

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    try {
      const [userRes, teamRes] = await Promise.all([
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (userRes.ok) setUsers(await userRes.json());
      if (teamRes.ok) setTeams(await teamRes.json());
    } catch (error) {
      toast.error('Failed to fetch users');
    }
  }, [token, modulePerms.can_view]);

  useEffect(() => {
    fetchData();
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('teams-updated', fetchData);
    return () => {
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('teams-updated', fetchData);
    };
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    const url = editingId ? `/api/users/${editingId}` : '/api/users';
    const method = editingId ? 'PUT' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        if (editingId && formData.password) {
          toast.success('User password updated successfully');
        } else {
          toast.success(editingId ? 'User updated successfully' : 'User created successfully');
        }
        setIsModalOpen(false);
        setEditingId(null);
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to save user');
    }
  };

  const handleDelete = async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/users/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('User deleted');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete');
      }
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  const openEdit = (user: User) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    setEditingId(user.id);
    setShowPassword(false);
    setFormData({
      username: user.username,
      full_name: user.full_name,
      email: user.email || '',
      role: user.role,
      team_id: user.team_id || '',
      password: ''
    });
    setIsModalOpen(true);
  };

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Users</h1>
          <p className="text-text-3 mt-1 text-xs">Manage team members and system access</p>
        </div>
        {modulePerms.can_create && (
          <button
            onClick={() => { 
              setEditingId(null); 
              setShowPassword(false); 
              
              let defaultTeamId = '';
              if (currentUser?.role === 'tl') {
                const tlTeams = teams.filter(t => t.team_leader_id === currentUser.id);
                if (tlTeams.length > 0) {
                  defaultTeamId = tlTeams[0].id;
                }
              }
              
              setFormData({ 
                username: '', 
                full_name: '', 
                email: '', 
                role: 'member', 
                team_id: defaultTeamId, 
                password: '' 
              }); 
              setIsModalOpen(true); 
            }}
            className="w-full sm:w-auto bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            Add User
          </button>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">User</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Role</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Team</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Status</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand font-bold">
                      {u.full_name[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text">{u.full_name}</div>
                      <div className="text-xs text-text-3">{u.email || u.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    u.role === 'super_admin' ? 'bg-error/10 text-error' : u.role === 'admin' ? 'bg-surface-2 text-text-3 border border-border' : u.role === 'hr' ? 'bg-surface-2 text-text-3 border border-border' : 'bg-brand/10 text-brand'
                  }`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-text-3">{u.team_name || '—'}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    u.is_active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                  }`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    {modulePerms.can_edit && u.role !== 'super_admin' && (
                      <button onClick={() => openEdit(u)} className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors">
                        <Edit2 size={16} />
                      </button>
                    )}
                    {modulePerms.can_delete && u.id !== currentUser?.id && u.role !== 'super_admin' && (
                      <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-error/10 rounded-lg text-text-3 hover:text-error transition-colors">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-8 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-6 text-text">{editingId ? 'Edit User' : 'Create User'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Full Name</label>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                    disabled={!!editingId}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  >
                    <option value="member">Member</option>
                    <option value="tl">Team Leader</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                    {currentUser?.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team</label>
                  <select
                    value={formData.team_id}
                    onChange={(e) => setFormData({ ...formData, team_id: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={currentUser?.role === 'tl' && teams.filter(t => t.team_leader_id === currentUser.id).length <= 1}
                  >
                    <option value="">No Team</option>
                    {teams
                      .filter(t => currentUser?.role === 'tl' ? t.team_leader_id === currentUser.id : true)
                      .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              {(currentUser?.role === 'super_admin' || currentUser?.role === 'admin' || !editingId) && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">
                    {editingId ? 'Update Password (Leave blank to keep current)' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand pr-12"
                      required={!editingId}
                      placeholder={editingId ? 'Enter new password' : ''}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all">{editingId ? 'Update User' : 'Create User'}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone and will remove all access for this user."
      />
    </div>
  );
}
