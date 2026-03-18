import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { ProductionEntry, Team, User, Target } from '../types';
import { Plus, Search, Download, Lock, LockOpen, Edit2, Trash2, Shield } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { motion } from 'motion/react';
import ConfirmationModal from '../components/ConfirmationModal';

export default function Production() {
  const { token, user: currentUser, permissions } = useAuth();
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 1
  });
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    team: '',
    dayFilter: 'this_month',
    customFrom: '',
    customTo: ''
  });

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['production'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);

  const [formData, setFormData] = useState({
    team_id: '',
    user_id: '',
    client_name: '',
    date: new Date().toISOString().split('T')[0],
    production_value: 0,
    target_value: 0,
    quality: '',
    notes: ''
  });

  const getFilterDates = useCallback(() => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    let from = '';
    let to = today;

    switch (filters.dayFilter) {
      case 'today':
        from = today;
        break;
      case 'this_week': {
        const first = now.getDate() - now.getDay();
        const firstDay = new Date(now.setDate(first)).toISOString().split('T')[0];
        from = firstDay;
        break;
      }
      case 'this_month': {
        from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        break;
      }
      case 'custom':
        from = filters.customFrom;
        to = filters.customTo;
        break;
    }
    return { from, to };
  }, [filters.dayFilter, filters.customFrom, filters.customTo]);

  const fetchData = useCallback(async () => {
    if (!modulePerms.can_view || !token) return;
    setIsLoading(true);
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        team_id: filters.team,
        search: filters.search,
        from,
        to
      });

      const [prodRes, teamRes, userRes, targetRes, settingsRes] = await Promise.all([
        fetch(`/api/production?${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/targets', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/global-settings', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      
      if (prodRes.ok) {
        const result = await prodRes.json();
        setEntries(result.data);
        setPagination(result.pagination);
      }
      if (teamRes.ok) {
        const fetchedTeams = await teamRes.json();
        setTeams(fetchedTeams);
        if (currentUser?.role === 'member' && !filters.team) {
          setFilters(prev => ({ ...prev, team: currentUser.team_id || '' }));
        }
      }
      if (userRes.ok) setUsers(await userRes.json());
      if (targetRes.ok) setTargets(await targetRes.json());
      if (settingsRes.ok) setGlobalSettings(await settingsRes.json());
    } catch (error) {
      toast.error('Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, [token, modulePerms.can_view, pagination.page, pagination.limit, filters.team, filters.search, getFilterDates, currentUser]);

  useEffect(() => {
    fetchData();
    window.addEventListener('users-updated', fetchData);
    window.addEventListener('teams-updated', fetchData);
    window.addEventListener('production-updated', fetchData);
    return () => {
      window.removeEventListener('users-updated', fetchData);
      window.removeEventListener('teams-updated', fetchData);
      window.removeEventListener('production-updated', fetchData);
    };
  }, [fetchData]);

  // Auto-fill client and target when team/user/date changes
  useEffect(() => {
    if (!editingId && (formData.team_id || formData.user_id) && formData.date) {
      const selectedTeam = teams.find(t => t.id === formData.team_id);
      if (selectedTeam) {
        setFormData(prev => prev.client_name !== selectedTeam.client_name ? { ...prev, client_name: selectedTeam.client_name || '' } : prev);
      }

      let target = null;
      if (formData.user_id) {
        const userTargets = targets.filter(t => t.user_id === formData.user_id);
        target = userTargets.find(t => t.effective_date === formData.date);
        if (!target) {
          target = userTargets
            .filter(t => new Date(t.effective_date) <= new Date(formData.date))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
      }

      if (!target && formData.team_id) {
        const teamTargets = targets.filter(t => t.team_id === formData.team_id && !t.user_id);
        target = teamTargets.find(t => t.effective_date === formData.date);
        if (!target) {
          target = teamTargets
            .filter(t => new Date(t.effective_date) <= new Date(formData.date))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
        if (!target) {
          target = teamTargets.sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
      }

      if (target) {
        setFormData(prev => prev.target_value !== target.target_value ? { ...prev, target_value: target.target_value } : prev);
      }
    }
  }, [formData.team_id, formData.user_id, formData.date, targets, editingId, teams]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pagination.page !== 1) {
        setPagination(prev => ({ ...prev, page: 1 }));
      } else {
        fetchData();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId && !modulePerms.can_edit) return toast.error('No permission to edit');
    if (!editingId && !modulePerms.can_create) return toast.error('No permission to create');

    const url = editingId ? `/api/production/${editingId}` : '/api/production';
    const method = editingId ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success(editingId ? 'Entry updated' : 'Entry added. Please lock it to finalize.');
        setIsModalOpen(false);
        setEditingId(null);
        fetchData();
      } else {
        toast.error('Failed to save entry');
      }
    } catch (error) {
      toast.error('Connection error');
    }
  }, [editingId, modulePerms.can_edit, modulePerms.can_create, token, formData, fetchData]);

  const handleDelete = useCallback(async (id: string) => {
    if (!modulePerms.can_delete) return toast.error('No permission to delete');
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  }, [modulePerms.can_delete]);

  const confirmDelete = useCallback(async () => {
    if (!itemToDelete) return;
    try {
      const response = await fetch(`/api/production/${itemToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        toast.success('Entry deleted');
        fetchData();
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to delete');
      }
    } catch (error) {
      toast.error('Failed to delete');
    }
  }, [itemToDelete, token, fetchData]);

  const openEdit = useCallback((entry: ProductionEntry) => {
    if (!modulePerms.can_edit) return toast.error('No permission to edit');
    if (entry.is_locked && currentUser?.role !== 'super_admin') {
      return toast.error('Cannot edit a locked entry');
    }
    setEditingId(entry.id);
    setFormData({
      team_id: entry.team_id,
      user_id: entry.user_id,
      client_name: entry.client_name || '',
      date: entry.date,
      production_value: entry.production_value,
      target_value: entry.target_value,
      quality: entry.quality || '',
      notes: entry.notes || ''
    });
    setIsModalOpen(true);
  }, [modulePerms.can_edit, currentUser?.role]);

  const handleQualityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    
    // If the user deleted the % symbol, we should also delete the last digit
    if (formData.quality.endsWith('%') && val === formData.quality.slice(0, -1)) {
      val = val.slice(0, -1);
    }
    
    const digits = val.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, quality: digits ? `${digits}%` : '' }));
  }, [formData.quality]);

  const toggleLock = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/production/${id}/toggle-lock`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, is_locked: !e.is_locked } : e));
        toast.success('Lock status updated');
      } else {
        const data = await response.json();
        toast.error(data.message || 'Failed to update lock status');
      }
    } catch (error) {
      toast.error('Connection error');
    }
  }, [token]);

  const handleExport = useCallback(async () => {
    setIsLoading(true);
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        limit: '10000', // Fetch a large number for export
        team_id: filters.team,
        search: filters.search,
        from,
        to
      });

      const response = await fetch(`/api/production?${queryParams}`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });

      if (!response.ok) throw new Error('Failed to fetch data for export');
      
      const result = await response.json();
      const allFilteredEntries = result.data;

      if (allFilteredEntries.length === 0) {
        toast.error('No data to export');
        return;
      }

      const dataToExport = allFilteredEntries.map((entry: any) => ({
        'Date': entry.date,
        'Team': entry.team_name,
        'User': entry.user_name,
        'Client': entry.client_name || '—',
        'Production': entry.production_value,
        'Target': entry.target_value,
        'Performance (%)': Math.round((entry.production_value / entry.target_value) * 100),
        'Quality': entry.quality || '—',
        'Notes': entry.notes || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Production Data');
      
      // Set column widths
      worksheet['!cols'] = [
        { wch: 12 }, // Date
        { wch: 20 }, // Team
        { wch: 20 }, // User
        { wch: 20 }, // Client
        { wch: 12 }, // Production
        { wch: 12 }, // Target
        { wch: 15 }, // Performance
        { wch: 12 }, // Quality
        { wch: 30 }, // Notes
      ];

      XLSX.writeFile(workbook, `Production_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Excel file exported successfully');
    } catch (error) {
      toast.error('Failed to export data');
    } finally {
      setIsLoading(false);
    }
  }, [getFilterDates, filters.team, filters.search, token]);

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view production data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">Production</h1>
          <p className="text-text-3 mt-1 text-xs">Track and manage production entries</p>
          {currentUser?.role === 'tl' && teams.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {teams.map(t => (
                <span key={t.id} className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand border border-brand/20">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={handleExport}
            className="flex-1 sm:flex-none bg-surface border border-border hover:border-brand/50 text-text px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
          >
            <Download size={20} />
            Export to Excel
          </button>
          {modulePerms.can_create && (
            <button
              onClick={() => {
                const latestMe = users.find(u => u.id === currentUser?.id) || currentUser;
                setEditingId(null);
                setFormData({
                  team_id: latestMe?.role === 'member' ? latestMe.team_id || '' : (teams.filter(t => t.team_leader_id === latestMe?.id).length === 1 ? teams.filter(t => t.team_leader_id === latestMe?.id)[0].id : ''),
                  user_id: (latestMe?.role === 'member' || latestMe?.role === 'tl') ? latestMe.id : '',
                  client_name: '',
                  date: new Date().toISOString().split('T')[0],
                  production_value: 0,
                  target_value: 0,
                  quality: '',
                  notes: ''
                });
                setIsModalOpen(true);
              }}
              className="flex-1 sm:flex-none bg-brand hover:bg-brand-hover text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand/20"
            >
              <Plus size={20} />
              Add Entry
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-surface border border-border rounded-2xl p-4">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" size={14} />
            <input 
              type="text"
              placeholder="Search..."
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
              className="w-full bg-bg border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-text outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Team</label>
          <select 
            value={filters.team}
            onChange={(e) => setFilters({...filters, team: e.target.value})}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={currentUser?.role === 'member'}
          >
            <option value="">All Teams</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Day Filter</label>
          <select 
            value={filters.dayFilter}
            onChange={(e) => setFilters({...filters, dayFilter: e.target.value})}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
          >
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
            <option value="custom">Custom Date</option>
          </select>
        </div>
        {filters.dayFilter === 'custom' && (
          <>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">From</label>
              <input 
                type="date" 
                value={filters.customFrom}
                onChange={(e) => setFilters({...filters, customFrom: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">To</label>
              <input 
                type="date" 
                value={filters.customTo}
                onChange={(e) => setFilters({...filters, customTo: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
              />
            </div>
          </>
        )}
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-bg-secondary border-b border-border">
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Date</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Team</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">User</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Client</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Production</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Target</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Status</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Quality</th>
                {(modulePerms.can_edit || modulePerms.can_delete) && <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const perf = Math.round((entry.production_value / entry.target_value) * 100);
                const allowedUnlockRoles = globalSettings.unlock_roles ? globalSettings.unlock_roles.split(',') : ['super_admin', 'admin', 'hr'];
                const canUnlock = currentUser && allowedUnlockRoles.includes(currentUser.role);
                const canEditLocked = currentUser?.role === 'super_admin';

                return (
                  <tr key={entry.id} className="hover:bg-bg-secondary/50 transition-colors group">
                    <td className="px-6 py-4 font-mono text-xs text-text">{entry.date}</td>
                    <td className="px-6 py-4 text-sm text-text">{entry.team_name}</td>
                    <td className="px-6 py-4 text-sm font-medium text-text">{entry.user_name}</td>
                    <td className="px-6 py-4 text-sm text-text-3">{entry.client_name || '—'}</td>
                    <td className="px-6 py-4 text-sm font-mono text-right text-text">{entry.production_value.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm font-mono text-right text-text-3">{entry.target_value.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        perf >= 100 ? 'bg-success/10 text-success' : perf >= 80 ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'
                      }`}>
                        {perf}%
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-center text-text-3">{entry.quality || '—'}</td>
                    {(modulePerms.can_edit || modulePerms.can_delete) && (
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {modulePerms.can_edit && (!entry.is_locked || canUnlock) && (
                            <button 
                              onClick={() => toggleLock(entry.id)} 
                              className={`p-2 rounded-lg transition-colors ${
                                entry.is_locked 
                                  ? 'text-brand bg-brand/10' 
                                  : 'text-text-3 hover:bg-border'
                              }`}
                              title={entry.is_locked ? 'Unlock Entry' : 'Lock Entry'}
                            >
                              {entry.is_locked ? <Lock size={16} /> : <LockOpen size={16} />}
                            </button>
                          )}
                          {modulePerms.can_edit && (!entry.is_locked || canEditLocked) && (
                            <button 
                              onClick={() => openEdit(entry)} 
                              className="p-2 hover:bg-border rounded-lg text-text-3 hover:text-brand transition-colors" 
                              title="Edit Entry"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {modulePerms.can_delete && (
                            <button 
                              onClick={() => handleDelete(entry.id)} 
                              disabled={entry.is_locked}
                              className={`p-2 rounded-lg transition-colors ${entry.is_locked ? 'opacity-30 cursor-not-allowed' : 'text-text-3 hover:bg-error/10 hover:text-error'}`}
                              title={entry.is_locked ? 'Cannot delete locked entry' : 'Delete Entry'}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 bg-bg-secondary border-t border-border flex items-center justify-between">
            <div className="text-xs text-text-3">
              Showing <span className="font-bold text-text">{(pagination.page - 1) * pagination.limit + 1}</span> to <span className="font-bold text-text">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-bold text-text">{pagination.total}</span> entries
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page === 1}
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-bold text-text disabled:opacity-50 hover:bg-bg transition-colors"
              >
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum = pagination.page;
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1;
                  } else {
                    if (pagination.page <= 3) pageNum = i + 1;
                    else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i;
                    else pageNum = pagination.page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${pagination.page === pageNum ? 'bg-brand text-white' : 'bg-surface border border-border text-text hover:bg-bg'}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: Math.min(pagination.totalPages, prev.page + 1) }))}
                disabled={pagination.page === pagination.totalPages}
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-bold text-text disabled:opacity-50 hover:bg-bg transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface border border-border rounded-3xl p-8 w-full max-w-lg shadow-2xl"
          >
            <h2 className="text-xl font-bold mb-6 text-text">{editingId ? 'Edit Entry' : 'Add Production Entry'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!editingId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Team</label>
                    <select
                      value={formData.team_id}
                      onChange={(e) => setFormData({ ...formData, team_id: e.target.value })}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      required
                      disabled={currentUser?.role === 'member'}
                    >
                      <option value="">Select Team</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">User</label>
                    <select
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      required
                      disabled={currentUser?.role === 'member'}
                    >
                      <option value="">Select User</option>
                      {users.filter(u => !formData.team_id || u.team_id === formData.team_id).map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Client</label>
                  <input
                    type="text"
                    value={formData.client_name}
                    readOnly
                    className="w-full bg-bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-text-3 outline-none cursor-not-allowed"
                    placeholder="Client name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Production</label>
                  <input
                    type="number"
                    value={formData.production_value}
                    onChange={(e) => setFormData({ ...formData, production_value: parseInt(e.target.value) || 0 })}
                    className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Target</label>
                  <input
                    type="number"
                    value={formData.target_value}
                    readOnly
                    className="w-full bg-bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-text-3 outline-none cursor-not-allowed"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Quality</label>
                <input
                  type="text"
                  value={formData.quality}
                  onChange={handleQualityChange}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand"
                  placeholder="e.g. 95"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-text-3 font-bold mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 text-sm text-text outline-none focus:border-brand h-20 resize-none"
                  placeholder="Optional notes..."
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-brand hover:bg-brand-hover text-white font-bold py-3 rounded-xl transition-all"
                >
                  {editingId ? 'Update Entry' : 'Save Entry'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 bg-border-2 hover:bg-border text-text font-bold py-3 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Production Entry"
        message="Are you sure you want to delete this production entry? This action cannot be undone."
      />
    </div>
  );
}
