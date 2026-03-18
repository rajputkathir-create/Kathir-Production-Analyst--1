import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { DashboardStats, ProductionEntry, Team, User } from '../types';
import { TrendingUp, Target, Users, ClipboardList, Zap, Activity, RotateCcw, Shield } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from 'recharts';

export default function Dashboard() {
  const { token, user: currentUser, permissions } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [filters, setFilters] = useState({
    team: '',
    user: '',
    client: '',
    dayFilter: 'this_month',
    customFrom: '',
    customTo: '',
    memberView: 'personal' as 'personal' | 'team'
  });

  const getFilterDates = useCallback(() => {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      
      let from = '';
      let to = today;

      const dateCopy = new Date(now.getTime());

      switch (filters.dayFilter) {
        case 'today':
          from = today;
          break;
        case 'this_week': {
          const day = dateCopy.getDay();
          const diff = dateCopy.getDate() - day + (day === 0 ? -6 : 1);
          const firstDay = new Date(dateCopy.setDate(diff)).toISOString().split('T')[0];
          from = firstDay;
          break;
        }
        case 'this_month': {
          from = new Date(dateCopy.getFullYear(), dateCopy.getMonth(), 1).toISOString().split('T')[0];
          break;
        }
        case 'this_year': {
          from = new Date(dateCopy.getFullYear(), 0, 1).toISOString().split('T')[0];
          break;
        }
        case 'custom':
          from = filters.customFrom || '';
          to = filters.customTo || today;
          break;
      }
      return { from, to };
    } catch (err) {
      console.error('Error in getFilterDates:', err);
      return { from: '', to: new Date().toISOString().split('T')[0] };
    }
  }, [filters.dayFilter, filters.customFrom, filters.customTo]);

  const modulePerms = useMemo(() => {
    if (currentUser?.role === 'super_admin') {
      return { can_view: true, can_create: true, can_edit: true, can_delete: true };
    }
    return permissions?.['dashboard'] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
  }, [currentUser?.role, permissions]);

  const fetchData = useCallback(async (showLoading = true) => {
    if (!modulePerms.can_view || !token) return;
    
    if (showLoading) setIsLoading(true);
    
    try {
      const { from, to } = getFilterDates();
      const queryParams = new URLSearchParams({
        team_id: filters.team || '',
        user_id: filters.user || '',
        from: from || '',
        to: to || ''
      });

      const prodQueryParams = new URLSearchParams(queryParams);
      prodQueryParams.append('limit', '500'); 

      const [statsRes, prodRes, teamRes, userRes] = await Promise.all([
        fetch(`/api/dashboard/stats?${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`/api/production?${prodQueryParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/teams', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (prodRes.ok) {
        const result = await prodRes.json();
        setEntries(result.data || []);
      }

      if (teamRes.ok) {
        const fetchedTeams = await teamRes.json();
        setTeams(fetchedTeams || []);
        
        if (showLoading && currentUser && !filters.team) {
          if (currentUser.role === 'tl' && fetchedTeams.length > 0) {
            setFilters(prev => ({ ...prev, team: fetchedTeams[0].id }));
          } else if (currentUser.role === 'member') {
            const userTeam = fetchedTeams.find((t: Team) => t.id === currentUser.team_id);
            setFilters(prev => ({ 
              ...prev, 
              team: currentUser.team_id || '',
              client: userTeam?.client_name || ''
            }));
          }
        }
      }

      if (userRes.ok) {
        const fetchedUsers = await userRes.json();
        setUsers(fetchedUsers || []);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [token, modulePerms.can_view, getFilterDates, filters.team, filters.user, currentUser]);

  useEffect(() => {
    fetchData(true);
    
    const interval = setInterval(() => {
      fetchData(false);
    }, 60000);
    
    const handleUpdate = () => fetchData(false);
    window.addEventListener('users-updated', handleUpdate);
    window.addEventListener('teams-updated', handleUpdate);
    window.addEventListener('production-updated', handleUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('users-updated', handleUpdate);
      window.removeEventListener('teams-updated', handleUpdate);
      window.removeEventListener('production-updated', handleUpdate);
    };
  }, [fetchData]);

  const latestMe = useMemo(() => users.find(u => u.id === currentUser?.id) || currentUser, [users, currentUser]);
  const myTeam = useMemo(() => teams.find(t => t.id === latestMe?.team_id), [teams, latestMe]);

  // Prepare chart data - memoized to prevent recalculation on every render
  const dailyData = useMemo(() => (entries || []).slice(0, 14).reverse().map(e => {
    const prod = Number(e.production_value) || 0;
    const tgt = Number(e.target_value) || 0;
    return {
      date: e.date ? e.date.split('-').slice(1).join('-') : '?',
      production: prod,
      target: tgt,
      performance: tgt > 0 ? Math.round((prod / tgt) * 100) : 0
    };
  }), [entries]);

  // Team performance data - memoized
  const teamPerfData = useMemo(() => teams.map(t => {
    const teamEntries = entries.filter(e => e.team_id === t.id);
    const prod = teamEntries.reduce((sum, e) => sum + e.production_value, 0);
    const tgt = teamEntries.reduce((sum, e) => sum + e.target_value, 0);
    return {
      name: t.name,
      production: prod,
      target: tgt
    };
  }).filter(t => t.production > 0 || t.target > 0), [teams, entries]);

  // Top performers - memoized
  const userPerf = useMemo(() => users.map(u => {
    const userEntries = entries.filter(e => e.user_id === u.id);
    if (userEntries.length === 0) return null;
    const prod = userEntries.reduce((sum, e) => sum + e.production_value, 0);
    const tgt = userEntries.reduce((sum, e) => sum + e.target_value, 0);
    return {
      name: u.full_name,
      pct: tgt > 0 ? Math.round((prod / tgt) * 100) : 0
    };
  }).filter(u => u !== null).sort((a, b) => b!.pct - a!.pct).slice(0, 5), [users, entries]);

  const clients = useMemo(() => Array.from(new Set(teams
    .filter(t => {
      if (currentUser?.role === 'tl') return t.team_leader_id === currentUser.id;
      if (currentUser?.role === 'member') return t.id === currentUser.team_id;
      return true;
    })
    .map(t => t.client_name).filter(Boolean))) as string[], [teams, currentUser]);

  const kpis = useMemo(() => [
    { label: 'Total Entries', value: stats?.totalEntries || 0, icon: ClipboardList, color: 'var(--accent-primary)' },
    { label: 'Total Production', value: (stats?.totalProduction || 0).toLocaleString(), icon: TrendingUp, color: 'var(--text-primary)' },
    { label: 'Total Target', value: (stats?.totalTarget || 0).toLocaleString(), icon: Target, color: 'var(--text-primary)' },
    { label: 'Avg Performance', value: `${Math.round(stats?.averagePerformance || 0)}%`, icon: Zap, color: 'var(--text-primary)' },
    { label: 'Teams', value: stats?.teamCount || 0, icon: Users, color: 'var(--text-primary)' },
    { label: 'Active Users', value: stats?.userCount || 0, icon: Activity, color: 'var(--text-primary)' },
  ], [stats]);

  if (!modulePerms.can_view) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-3">
        <Shield size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-bold text-text">Access Denied</h2>
        <p className="text-sm">You do not have permission to view the dashboard.</p>
      </div>
    );
  }

  if (isLoading && !stats) return <div className="flex items-center justify-center h-[60vh] text-text-3">Loading analytics...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
              {currentUser?.role === 'tl' || currentUser?.role === 'member' 
                ? `Welcome, ${currentUser.full_name.split(' ')[0]}` 
                : 'Dashboard'}
            </h1>
            <p className="text-text-3 text-xs mt-1">
              {currentUser?.role === 'tl' 
                ? 'Overview of your team\'s performance and production' 
                : currentUser?.role === 'member'
                  ? 'Your personal production and team overview'
                  : 'Production analytics & performance overview'}
            </p>
          </div>
          {isLoading && (
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-brand border-t-transparent mt-1"></div>
          )}
        </div>
        <button 
          type="button"
          onClick={() => fetchData(true)}
          className="bg-surface border border-border hover:border-brand/50 text-text text-[10px] font-bold px-3 py-1.5 rounded-md flex items-center gap-2 transition-all w-full sm:w-auto justify-center"
        >
          <RotateCcw size={12} className={`text-brand ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>



      {/* Filters */}
      <div className="bg-surface border border-border rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text mb-4">Filters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Team</label>
            {currentUser?.role === 'member' ? (
              <div className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text">
                {myTeam?.name || 'No Team'}
              </div>
            ) : (
              <select 
                value={filters.team}
                onChange={(e) => setFilters({...filters, team: e.target.value, user: ''})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentUser?.role === 'member'}
              >
                <option value="">All Teams</option>
                {teams
                  .filter(t => {
                    if (currentUser?.role === 'tl') return t.team_leader_id === currentUser.id;
                    if (currentUser?.role === 'member') return t.id === currentUser.team_id;
                    return true;
                  })
                  .filter(t => !filters.client || t.client_name === filters.client)
                  .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Member</label>
            <select 
              value={filters.user}
              onChange={(e) => setFilters({...filters, user: e.target.value})}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand"
            >
              <option value="">All Members</option>
              {users.filter(u => {
                if (currentUser?.role === 'tl') {
                  const team = teams.find(t => t.id === u.team_id);
                  if (team?.team_leader_id !== currentUser.id) return false;
                } else if (currentUser?.role === 'member') {
                  if (u.team_id !== currentUser.team_id) return false;
                }
                
                if (filters.team && u.team_id !== filters.team) return false;
                if (filters.client) {
                  const team = teams.find(t => t.id === u.team_id);
                  if (team?.client_name !== filters.client) return false;
                }
                return true;
              }).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-text-3 tracking-wider">Client</label>
            {currentUser?.role === 'member' ? (
              <div className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text">
                {myTeam?.client_name || 'General'}
              </div>
            ) : (
              <select 
                value={filters.client}
                onChange={(e) => setFilters({...filters, client: e.target.value})}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-brand disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={currentUser?.role === 'member'}
              >
                <option value="">All Clients</option>
                {clients.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
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
              <option value="this_year">This Year</option>
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
          
          <button 
            type="button"
            onClick={() => setFilters(prev => ({
              ...prev,
              team: currentUser?.role === 'member' || (currentUser?.role === 'tl' && teams.length === 1) ? prev.team : '',
              client: currentUser?.role === 'member' ? prev.client : '',
              user: '', 
              dayFilter: 'this_month', 
              customFrom: '', 
              customTo: ''
            }))}
            className="bg-border-2 hover:bg-border text-text text-[10px] font-bold px-4 py-2.5 rounded-lg transition-colors w-full"
          >
            Clear
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      {currentUser?.role !== 'member' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-4 flex justify-between items-start">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-text-3 mb-2">{kpi.label}</div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-text">{kpi.value}</div>
              </div>
              <div className="p-2 rounded-lg bg-bg/50 text-text-3">
                <kpi.icon size={16} className={i === 3 ? "text-brand" : ""} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Daily Production Trend</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                  itemStyle={{ color: 'var(--text-primary)', fontSize: '12px' }}
                />
                <Legend verticalAlign="top" align="center" iconType="square" wrapperStyle={{ fontSize: '10px', paddingBottom: '20px' }} />
                <Area name="Production" type="monotone" dataKey="production" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.1} strokeWidth={2} isAnimationActive={true} animationDuration={500} />
                <Area name="Target" type="monotone" dataKey="target" stroke="var(--warning-color)" fill="transparent" strokeDasharray="5 5" strokeWidth={1.5} isAnimationActive={true} animationDuration={500} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
          <h3 className="text-xs font-bold text-text mb-6">Performance % by Day</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} domain={[0, 120]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                  cursor={{ fill: 'var(--border-primary)' }}
                />
                <Bar dataKey="performance" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500}>
                  {dailyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.performance >= 100 ? 'var(--success-color)' : entry.performance >= 80 ? 'var(--warning-color)' : 'var(--error-color)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${currentUser?.role === 'member' ? 'lg:col-span-3' : 'lg:col-span-2'} bg-surface border border-border rounded-2xl p-4 sm:p-6`}>
          <h3 className="text-xs font-bold text-text mb-6">Team Performance</h3>
          <div className="h-[250px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={teamPerfData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '12px' }}
                />
                <Legend verticalAlign="top" align="center" iconType="square" wrapperStyle={{ fontSize: '10px', paddingBottom: '20px' }} />
                <Bar name="Production" dataKey="production" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500} />
                <Bar name="Target" dataKey="target" fill="var(--warning-color)" fillOpacity={0.4} radius={[4, 4, 0, 0]} isAnimationActive={true} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {currentUser?.role !== 'member' && (
          <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
            <h3 className="text-xs font-bold text-text mb-6">Top Performers</h3>
            <div className="space-y-5">
              {userPerf.map((p, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-text-3">{i + 1}</span>
                      <span className="font-medium text-text">{p?.name}</span>
                    </div>
                    <span className="font-bold text-brand text-[10px]">{p?.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${p!.pct >= 100 ? 'bg-success' : 'bg-warning'}`}
                      style={{ width: `${Math.min(p!.pct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {userPerf.length === 0 && <div className="text-center py-10 text-text-3 text-xs">No data available</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
