import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { User, ProductionEntry, Target, Team } from '../types';
import { Users as UsersIcon, Shield, Mail, Hash, RefreshCw, Target as TargetIcon, TrendingUp, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'motion/react';

export default function MyTeam() {
  const { token, user: currentUser } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [myProduction, setMyProduction] = useState<ProductionEntry[]>([]);
  const [myTarget, setMyTarget] = useState<number>(0);
  const [allTargets, setAllTargets] = useState<Target[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const fetchMyData = useCallback(async (showLoading = true) => {
    if (currentUser?.role !== 'tl') return;
    if (showLoading) setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const [membersRes, prodRes, targetRes, teamsRes] = await Promise.all([
        fetch('/api/my-team', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/production?user_id=${currentUser.id}&from=${today}&to=${today}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/targets', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (membersRes.ok) {
        setMembers(await membersRes.json());
      }

      if (prodRes.ok) {
        const prodData = await prodRes.json();
        setMyProduction(prodData.data || []);
      }

      if (targetRes.ok) {
        const targetsData: Target[] = await targetRes.json();
        setAllTargets(targetsData);
        const userTargets = targetsData.filter(t => t.user_id === currentUser.id);
        
        // Find target for today
        let target = userTargets.find(t => t.effective_date === today);
        if (!target) {
          target = userTargets
            .filter(t => new Date(t.effective_date) <= new Date(today))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
        
        if (target) {
          setMyTarget(target.target_value);
        } else {
          // Fallback to team target if no user target
          const teamTargets = targetsData.filter(t => t.team_id === currentUser.team_id && !t.user_id);
          let tTarget = teamTargets.find(t => t.effective_date === today);
          if (!tTarget) {
            tTarget = teamTargets
              .filter(t => new Date(t.effective_date) <= new Date(today))
              .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
          }
          if (tTarget) setMyTarget(tTarget.target_value);
        }
      }

      if (teamsRes.ok) {
        setTeams(await teamsRes.json());
      }
    } catch (error) {
      console.error('Failed to fetch team data', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [token, currentUser]);

  useEffect(() => {
    fetchMyData(true);
    
    // Poll for updates every 30 seconds to automatically reflect changes
    const interval = setInterval(() => {
      fetchMyData(false);
    }, 30000);
    
    const handleUpdate = () => fetchMyData(false);
    window.addEventListener('users-updated', handleUpdate);
    window.addEventListener('teams-updated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('users-updated', handleUpdate);
      window.removeEventListener('teams-updated', handleUpdate);
    };
  }, [fetchMyData]);

  // Update target in form when date changes
  useEffect(() => {
    if (isModalOpen && formData.date && currentUser) {
      const userTargets = allTargets.filter(t => t.user_id === currentUser.id);
      let target = userTargets.find(t => t.effective_date === formData.date);
      if (!target) {
        target = userTargets
          .filter(t => new Date(t.effective_date) <= new Date(formData.date))
          .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
      }

      if (target) {
        setFormData(prev => ({ ...prev, target_value: target.target_value }));
      } else {
        const teamTargets = allTargets.filter(t => t.team_id === currentUser.team_id && !t.user_id);
        let tTarget = teamTargets.find(t => t.effective_date === formData.date);
        if (!tTarget) {
          tTarget = teamTargets
            .filter(t => new Date(t.effective_date) <= new Date(formData.date))
            .sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
        }
        if (tTarget) {
          setFormData(prev => ({ ...prev, target_value: tTarget.target_value }));
        }
      }
    }
  }, [formData.date, isModalOpen, allTargets, currentUser]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast.success('Production entry added');
        setIsModalOpen(false);
        fetchMyData();
      } else {
        toast.error('Failed to save entry');
      }
    } catch (error) {
      toast.error('Connection error');
    }
  }, [token, formData, fetchMyData]);

  const handleQualityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (formData.quality.endsWith('%') && val === formData.quality.slice(0, -1)) {
      val = val.slice(0, -1);
    }
    const digits = val.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, quality: digits ? `${digits}%` : '' }));
  }, [formData.quality]);

  const todayProduction = useMemo(() => myProduction.reduce((sum, e) => sum + e.production_value, 0), [myProduction]);
  const performance = useMemo(() => myTarget > 0 ? Math.round((todayProduction / myTarget) * 100) : 0, [myTarget, todayProduction]);

  if (currentUser?.role !== 'tl') {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">This page is restricted to Team Leaders.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">My Team</h1>
          <p className="text-text-3 mt-1 text-xs">View members assigned to your team and track your performance</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button 
            onClick={() => fetchMyData(true)}
            className="p-2.5 bg-surface border border-border hover:border-brand/50 rounded-xl text-text-3 hover:text-brand transition-all"
            title="Refresh Data"
          >
            <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center gap-2">
          <UsersIcon size={16} className="text-brand" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-text">Assigned Members ({members.length})</h3>
        </div>
        
        {isLoading ? (
          <div className="p-8 text-center text-text-3 text-sm">Loading members...</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-text-3 text-sm flex flex-col items-center">
            <UsersIcon size={32} className="mb-3 opacity-20" />
            <p>No members are currently assigned to you.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Member Name</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Username / ID</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Email</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold">Team</th>
                  <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-text-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-text flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-xs">
                        {member.full_name.charAt(0).toUpperCase()}
                      </div>
                      {member.full_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-3 font-mono">
                      <div className="flex items-center gap-1.5">
                        <Hash size={12} className="opacity-50" />
                        {member.username}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-3">
                      {member.email ? (
                        <div className="flex items-center gap-1.5">
                          <Mail size={12} className="opacity-50" />
                          {member.email}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-2 text-text-3 border border-border">
                        {member.team_name || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        member.is_active ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                      }`}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Entry Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface border border-border rounded-3xl p-8 w-full max-w-lg shadow-2xl"
          >
            <h2 className="text-xl font-bold mb-6 text-text">Record My Production</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                  Save Entry
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
    </div>
  );
}
