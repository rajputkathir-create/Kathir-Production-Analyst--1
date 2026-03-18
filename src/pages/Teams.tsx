import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { Team, User } from '../types';
import { Plus, Edit2, Trash2, Users as UsersIcon, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import ConfirmationModal from '../components/ConfirmationModal';

export default function Teams() {
  const { token, user: currentUser, permissions } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['teams'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    client_name: '',
    team_leader_id: '',
    member_ids: [] as string[]
  });

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    try {
      const [teamRes, userRes] = await Promise.all([
        fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (teamRes.ok) setTeams(await teamRes.json());
      if (userRes.ok) setUsers(await userRes.json());
    } catch (error) {
      toast.error('Failed to fetch data');
    }
  }, [token, modulePerms.can_view]);

  useEffect(() => {
    fetchData();
    window.addEventListener('teams-updated', fetchData);
    window.addEventListener('users-updated', fetchData);
    return () => {
      window.removeEventListener('teams-updated', fetchData);
      window.removeEventListener('users-updated', fetchData);
    };
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    const url = editingId ? `/api/teams/${editingId}` : '/api/teams';
    const method = editingId ? 'PUT' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        toast.success(editingId ? 'Team updated' : 'Team created');
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({ name: '', description: '', client_name: '', team_leader_id: '', member_ids: [] });
        fetchData();
      }
    } catch (error) {
      toast.error('Failed to save team');
    }
  };

  const openEdit = (team: Team) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    setEditingId(team.id);
    setFormData({ 
      name: team.name, 
      description: team.description || '', 
      client_name: team.client_name || '',
      team_leader_id: team.team_leader_id || '',
      member_ids: team.members?.map(m => m.id) || []
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/teams/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Team deleted');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete');
      }
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view teams.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Teams</h1>
          <p className="text-text-3 mt-1 text-xs">Manage production teams and clients</p>
        </div>
        {modulePerms.can_create && (
          <button
            onClick={() => { setEditingId(null); setFormData({ name: '', description: '', client_name: '', team_leader_id: '', member_ids: [] }); setIsModalOpen(true); }}
            className="w-full sm:w-auto bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
          >
            <Plus size={20} />
            Add Team
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {teams.map((team) => (
          <div key={team.id} className="bg-surface border border-border rounded-3xl p-6 hover:border-brand/30 transition-all group">
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 bg-brand/10 rounded-2xl flex items-center justify-center text-brand">
                <UsersIcon size={24} />
              </div>
              {(modulePerms.can_edit || modulePerms.can_delete) && (
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {modulePerms.can_edit && (
                    <button onClick={() => openEdit(team)} className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors">
                      <Edit2 size={16} />
                    </button>
                  )}
                  {modulePerms.can_delete && (
                    <button onClick={() => handleDelete(team.id)} className="p-2 hover:bg-error/10 rounded-lg text-text-3 hover:text-error transition-colors">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )}
            </div>
            <h3 className="text-lg font-bold mb-1 text-text">{team.name}</h3>
            {team.team_leader_name && <div className="text-xs text-brand font-medium mb-1">Leader: {team.team_leader_name}</div>}
            {team.client_name && <div className="text-xs text-text-3 mb-3">Client: {team.client_name}</div>}
            <p className="text-sm text-text-3 leading-relaxed line-clamp-2 mb-3">{team.description || 'No description provided.'}</p>
            <div className="text-xs text-text-3 font-medium">
              Members: {team.members ? team.members.length : 0}
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-8 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6 text-text">{editingId ? 'Edit Team' : 'Create Team'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team Leader</label>
                <select
                  value={formData.team_leader_id}
                  onChange={(e) => setFormData({ ...formData, team_leader_id: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  required
                >
                  <option value="">Select Team Leader</option>
                  {users.filter(u => u.role === 'tl').map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Client Name</label>
                <input
                  type="text"
                  value={formData.client_name}
                  onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand h-24 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all">{editingId ? 'Update' : 'Create'}</button>
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
        title="Delete Team"
        message="Are you sure you want to delete this team? This will permanently remove the team record. Note: This may affect historical production data associated with this team."
      />
    </div>
  );
}
