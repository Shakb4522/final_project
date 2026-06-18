import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from "jspdf";
import Markdown from 'markdown-to-jsx';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis, BarChart, Bar } from 'recharts';

// 4-Class model labels: crack, volumetric, union, surface
const DEFECT_STANDARDS = {
  'crack':      { std: 'ISO 5817 - Level B / ASME IX QW-462', desc: 'Critical structural crack — immediate rejection or repair mandatory. Re-weld and re-inspect per ASME Section IX.' },
  'volumetric': { std: 'ISO 5817 - Level C / API 1104 §9.3',  desc: 'Volumetric defect (porosity / slag inclusion) — check gas shielding, interpass cleaning, and heat input parameters.' },
  'union':      { std: 'ISO 5817 - Level B / ASME IX QW-193', desc: 'Lack of fusion or lack of penetration — increase heat input, clean base material, and verify electrode angle.' },
  'surface':    { std: 'ISO 5817 - Level D / AWS D1.1 §6.9',  desc: 'Surface irregularity (undercut / spatter / overlap) — adjust current, travel speed, and electrode angle to eliminate.' },
  'defect':     { std: 'ISO 5817 - General',                   desc: 'General weld anomaly detected. Manual review recommended per applicable inspection standard.' }
};

const RETRAIN_CLASSES = [
  { id: "porosity", name: "Porosity", color: "#3b82f6", rgb: "59,130,246" },
  { id: "slag", name: "Slag inclusion", color: "#10b981", rgb: "16,185,129" },
  { id: "crack", name: "Crack", color: "#ef4444", rgb: "239,68,68" },
  { id: "tungsten", name: "Tungsten inclusion", color: "#f59e0b", rgb: "245,158,11" },
  { id: "undercut", name: "Undercut", color: "#8b5cf6", rgb: "139,92,246" },
  { id: "lack_of_fusion", name: "Lack of fusion", color: "#ec4899", rgb: "236,72,153" },
  { id: "lack_of_penetration", name: "Lack of penetration", color: "#14b8a6", rgb: "20,184,166" },
  { id: "spatter", name: "Spatter", color: "#64748b", rgb: "100,116,139" },
  { id: "defect", name: "Defect", color: "#ef4444", rgb: "239,68,68" },
  { id: "good_weld", name: "Good Weld", color: "#10b981", rgb: "16,185,129" },
  { id: "bad_weld", name: "Bad Weld", color: "#f59e0b", rgb: "245,158,11" },
  { id: "volumetric", name: "Volumetric", color: "#3b82f6", rgb: "59,130,246" },
  { id: "union", name: "Union", color: "#f59e0b", rgb: "245,158,11" },
  { id: "surface", name: "Surface", color: "#8b5cf6", rgb: "139,92,246" },
  { id: "lack_of_union", name: "Lack of Union", color: "#f59e0b", rgb: "245,158,11" },
  { id: "inclusion", name: "Inclusion", color: "#ec4899", rgb: "236,72,153" }
];

const palette = [
  { rgb: "239, 68, 68", hex: "#ef4444" },   // Red
  { rgb: "59, 130, 246", hex: "#3b82f6" },  // Blue
  { rgb: "16, 185, 129", hex: "#10b981" },  // Green
  { rgb: "245, 158, 11", hex: "#f59e0b" },  // Amber
  { rgb: "168, 85, 247", hex: "#a855f7" },  // Purple
  { rgb: "6, 182, 212", hex: "#06b6d4" },   // Cyan
  { rgb: "236, 72, 153", hex: "#ec4899" }   // Pink
];

const labelColors = {};
let colorIndex = 0;

function getColorForLabel(label) {
  if (!labelColors[label]) {
    labelColors[label] = palette[colorIndex % palette.length];
    colorIndex++;
  }
  return labelColors[label];
}

const ModelDetailsModal = ({ isOpen, onClose, model, apiUrl, userId }) => {
  const [details, setDetails] = useState({ active_users: [], active_count: 0, recent_logs: [] });
  const [fullLogs, setFullLogs] = useState([]);
  const [showFullLogs, setShowFullLogs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [testing, setTesting] = useState(false);
  const [animPhase, setAnimPhase] = useState(0);

  useEffect(() => {
    if (!isOpen || !model?.model_key) return;
    setShowFullLogs(false); setFullLogs([]); setRouteData(null); setAnimPhase(0);
    const fetchDetails = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/model-details/${model.model_key}`);
        if (res.ok) setDetails(await res.json());
      } catch (e) { console.error(e); }
    };
    fetchDetails();
    const iv = setInterval(fetchDetails, 5000);
    return () => clearInterval(iv);
  }, [isOpen, model]);

  const loadFullLogs = async () => {
    if (!model?.model_key) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/model-logs/${model.model_key}`);
      if (res.ok) setFullLogs(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false); setShowFullLogs(true);
  };

  const runTrafficTest = async () => {
    if (!model?.model_key) return;
    setTesting(true); setAnimPhase(1); setRouteData(null);
    try {
      await new Promise(r => setTimeout(r, 800));
      const res = await fetch(`${apiUrl}/api/test-traffic/${model.model_key}`, {
        method: "POST", headers: { "x-user-id": userId || "Anonymous" }
      });
      if (res.ok) {
        const data = await res.json();
        setAnimPhase(2);
        await new Promise(r => setTimeout(r, 800));
        setRouteData(data); setAnimPhase(3);
      }
    } catch (e) { console.error(e); }
    setTesting(false);
  };

  if (!isOpen || !model) return null;

  const cIp = routeData?.client_ip || "—";
  const sIp = routeData?.server_ip || "—";
  const sHost = routeData?.server_host || model.model_name;
  const lat = routeData?.latency_ms || "—";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-card max-w-3xl w-full p-8 border-red-500/30 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">{model.model_name}</h3>
            <span className={`text-[10px] font-black px-3 py-1 rounded-full border ${model.status === 'OPERATIONAL' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}`}>{model.status}</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-black/30 p-4 rounded-xl border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Service Uptime</div>
            <div className="text-2xl font-black text-white">{model.uptime}</div>
          </div>
          <div className="bg-black/30 p-4 rounded-xl border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Active Users (5 min)</div>
            <div className="text-2xl font-black text-emerald-400">{details.active_count}</div>
          </div>
        </div>

        {/* Traffic Test */}
        <div className="mb-6">
          <button onClick={runTrafficTest} disabled={testing} className="w-full bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-all active:scale-[0.98] mb-4 disabled:opacity-50 shadow-lg shadow-red-900/20">
            {testing ? "⏳ Testing Traffic..." : "🔍 Test Traffic (Your Session)"}
          </button>

          {/* Route Map — Clean Design */}
          <div className="rounded-2xl border border-white/[0.06] p-6 relative overflow-hidden" style={{background:'linear-gradient(180deg, rgba(10,14,23,0.97), rgba(6,10,18,0.99))'}}>
            <div className="flex items-center justify-between mb-5 relative z-10">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-[0.15em]">Network Route</span>
              {animPhase===3&&<span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">{lat} ms</span>}
            </div>
            <svg viewBox="0 0 600 120" className="w-full relative z-10">
              <defs>
                <filter id="softGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                <linearGradient id="allerLine" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f59e0b" stopOpacity="0.5"/><stop offset="50%" stopColor="#f59e0b" stopOpacity="0.15"/><stop offset="100%" stopColor="#f59e0b" stopOpacity="0.5"/></linearGradient>
                <linearGradient id="retourLine" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.5"/><stop offset="50%" stopColor="#06b6d4" stopOpacity="0.15"/><stop offset="100%" stopColor="#06b6d4" stopOpacity="0.5"/></linearGradient>
              </defs>

              {/* Client */}
              <rect x="10" y="25" width="100" height="70" rx="16" fill="rgba(239,68,68,0.06)" stroke="rgba(239,68,68,0.25)" strokeWidth="1"/>
              <circle cx="60" cy="50" r="12" fill="rgba(239,68,68,0.1)" stroke="rgba(239,68,68,0.3)" strokeWidth="1"/>
              <text x="60" y="54" textAnchor="middle" fill="#ef4444" fontSize="11">👤</text>
              <text x="60" y="75" textAnchor="middle" fill="white" fontSize="8" fontWeight="700" fontFamily="monospace">{cIp}</text>
              <text x="60" y="86" textAnchor="middle" fill="#64748b" fontSize="6.5" fontFamily="monospace">{userId||"You"}</text>

              {/* Server */}
              <rect x="490" y="25" width="100" height="70" rx="16" fill="rgba(16,185,129,0.06)" stroke="rgba(16,185,129,0.25)" strokeWidth="1"/>
              <circle cx="540" cy="50" r="12" fill="rgba(16,185,129,0.1)" stroke="rgba(16,185,129,0.3)" strokeWidth="1"/>
              <text x="540" y="54" textAnchor="middle" fill="#10b981" fontSize="11">🖥</text>
              <text x="540" y="75" textAnchor="middle" fill="white" fontSize="8" fontWeight="700" fontFamily="monospace">{sIp}</text>
              <text x="540" y="86" textAnchor="middle" fill="#64748b" fontSize="6.5" fontFamily="monospace">{sHost}</text>

              {/* Aller path line */}
              <line x1="110" y1="52" x2="490" y2="52" stroke="url(#allerLine)" strokeWidth="1" strokeDasharray="4 6"/>
              <text x="300" y="46" textAnchor="middle" fill="#f59e0b" fontSize="7" fontWeight="600" fontFamily="monospace" opacity="0.7">REQUEST →</text>

              {/* Retour path line */}
              <line x1="490" y1="68" x2="110" y2="68" stroke="url(#retourLine)" strokeWidth="1" strokeDasharray="4 6"/>
              <text x="300" y="78" textAnchor="middle" fill="#06b6d4" fontSize="7" fontWeight="600" fontFamily="monospace" opacity="0.7">← RESPONSE</text>

              {/* Aller dots */}
              <g filter="url(#softGlow)">
                <circle r="3" fill="#f59e0b"><animateMotion dur="2.5s" repeatCount="indefinite" path="M110,52 L490,52"/></circle>
                <circle r="3" fill="#f59e0b" opacity="0.4"><animateMotion dur="2.5s" begin="1.25s" repeatCount="indefinite" path="M110,52 L490,52"/></circle>
              </g>

              {/* Retour dots */}
              <g filter="url(#softGlow)">
                <circle r="3" fill="#06b6d4"><animateMotion dur="2.5s" repeatCount="indefinite" path="M490,68 L110,68"/></circle>
                <circle r="3" fill="#06b6d4" opacity="0.4"><animateMotion dur="2.5s" begin="1.25s" repeatCount="indefinite" path="M490,68 L110,68"/></circle>
              </g>

              {/* Connection status */}
              <circle cx="60" cy="108" r="2.5" fill={animPhase>0?"#10b981":"#334155"}>{animPhase>0&&<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>}</circle>
              <text x="70" y="111" fill="#475569" fontSize="6" fontFamily="monospace">{animPhase>0?"Connected":"Ready"}</text>
              <circle cx="540" cy="108" r="2.5" fill={animPhase>=2?"#10b981":"#334155"}>{animPhase>=2&&<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>}</circle>
              <text x="530" y="111" fill="#475569" fontSize="6" fontFamily="monospace" textAnchor="end">{animPhase>=2?"Responded":"Waiting"}</text>
            </svg>

            {routeData&&animPhase===3&&(
              <div className="grid grid-cols-4 gap-3 mt-5 relative z-10">
                <div className="text-center p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"><div className="text-[8px] text-slate-500 uppercase font-bold tracking-widest mb-1">Source</div><div className="text-[11px] font-mono text-white">{routeData.client_ip}</div></div>
                <div className="text-center p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"><div className="text-[8px] text-slate-500 uppercase font-bold tracking-widest mb-1">Region</div><div className="text-[11px] font-mono text-white">{routeData.server_region}</div></div>
                <div className="text-center p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20"><div className="text-[8px] text-emerald-500/70 uppercase font-bold tracking-widest mb-1">Latency</div><div className="text-[11px] font-mono font-bold text-emerald-400">{routeData.latency_ms} ms</div></div>
                <div className="text-center p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"><div className="text-[8px] text-slate-500 uppercase font-bold tracking-widest mb-1">Time</div><div className="text-[11px] font-mono text-white">{routeData.timestamp?.split(' ')[1]}</div></div>
              </div>
            )}
          </div>
        </div>

        {/* Active Users */}
        <div className="mb-6">
          <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">Active Users (Last 5 Minutes)</h4>
          {details.active_users.length === 0 ? (
            <p className="text-slate-600 text-sm italic">No active users right now.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {details.active_users.map((u, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                  <span className="text-xs font-bold text-white">{u.username}</span>
                  <span className="text-[10px] font-mono text-slate-400">{u.ip}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Logs */}
        <div className="mb-4">
          <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">Recent Activity</h4>
          <div className="space-y-1">
            {details.recent_logs.length === 0 ? (
              <p className="text-slate-600 text-sm italic">No activity recorded yet.</p>
            ) : details.recent_logs.map((l, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-white/[0.02] rounded-lg border border-white/5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white">{l.username}</span>
                  <span className="text-[10px] font-mono text-slate-500">{l.ip}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">{l.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Full Logs */}
        {!showFullLogs ? (
          <button onClick={loadFullLogs} disabled={loading} className="w-full bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest py-3 rounded-xl transition-all active:scale-[0.98]">
            {loading ? "Loading..." : "View All Usage Logs"}
          </button>
        ) : (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Full Audit Log ({fullLogs.length} entries)</h4>
              <button onClick={() => setShowFullLogs(false)} className="text-[10px] text-red-400 hover:text-red-300">Hide</button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {fullLogs.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-white/[0.02] rounded border border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-white">{l.username}</span>
                    <span className="text-[10px] font-mono text-slate-500">{l.ip}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">{l.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

const GlobalTraffic = ({ stats = [], onSelect }) => {
  const validStats = Array.isArray(stats) ? stats : [];
  return (
    <div className="flex-1 flex flex-col gap-8">
      {validStats.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-20 glass-card border-dashed border-white/10 opacity-50">
          <h3 className="text-xl font-bold text-slate-400 uppercase tracking-tighter">No Service Data Available</h3>
          <p className="text-sm text-slate-500 mt-2">Connecting to infrastructure nodes...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {validStats.map((model, idx) => (
            <div key={idx} onClick={() => onSelect(model)} className="glass-card p-10 flex flex-col gap-8 relative overflow-hidden group cursor-pointer hover:border-red-500/40 transition-all active:scale-[0.98]">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <svg className="w-48 h-48 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5-10-5zM2 17l10 5 10-5-10-5-10 5z"/></svg>
              </div>
              <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center justify-between">
                  <h3 className="text-3xl font-black text-white tracking-tight uppercase leading-none">{model.model_name}</h3>
                  <span className={`text-[10px] font-black px-3 py-1 rounded-full border ${model.status === 'OPERATIONAL' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}`}>{model.status}</span>
                </div>
                <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md">{model.description}</p>
              </div>
              <div className="flex items-center gap-8 mt-auto relative z-10">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Service Uptime</span>
                  <span className="text-xl font-black text-white">{model.uptime}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Encryption</span>
                  <span className="text-xl font-black text-emerald-500">AES-256</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const UsersView = ({ users = [] }) => {
  return (
    <div className="flex-1 flex flex-col gap-6">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Registered Users</h2>
          <p className="text-slate-500 text-sm font-medium">System users registered in the database.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">{Array.isArray(users) ? users.filter(u => u.status === 'ONLINE').length : 0} Online</span>
        </div>
      </div>
      <div className="glass-card overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Username</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Role</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">IP Address</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {Array.isArray(users) && users.map((user, idx) => (
                <tr key={idx} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-white">{user.username}</td>
                  <td className="px-6 py-4 text-xs text-slate-400">{user.role}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-400">{user.ip}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`text-[10px] font-black px-3 py-1 rounded border ${user.status === 'ONLINE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-slate-500 border-white/10'}`}>{user.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


// ─── Analytics Stats View ──────────────────────────────────────────────────────
const AnalyticsView = ({ API_URL, inspections }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState('All');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/analytics/summary`);
        if (res.ok) setStats(await res.json());
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchStats();
  }, [API_URL]);

  const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899'];

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-slate-500 py-20">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-red-500/50 border-t-red-500 rounded-full animate-spin" />
        <span className="text-sm uppercase tracking-widest font-bold">Loading Analytics...</span>
      </div>
    </div>
  );

  const projectsList = stats?.project_breakdown || [];
  const projectNames = ['All', ...projectsList.map(p => p.project_name)];

  // Derived filtered state based on selectedProject
  let activeTotal = stats?.total_inspections || 0;
  let activeAccepted = stats?.accepted || 0;
  let activeRefused = stats?.refused || 0;
  let activePending = stats?.pending || 0;
  let activeRate = stats?.acceptance_rate || 0;
  let activeDefectData = stats?.defect_distribution || [];

  if (selectedProject !== 'All') {
    const projData = projectsList.find(p => p.project_name === selectedProject);
    if (projData) {
      activeTotal = projData.total;
      activeAccepted = projData.accepted;
      activeRefused = projData.refused;
      activePending = 0; // Seeding is complete
      activeRate = activeTotal ? round(activeAccepted / activeTotal * 100, 1) : 0;
      activeDefectData = [
        { type: 'crack', count: projData.cracks },
        { type: 'volumetric', count: projData.volumetric },
        { type: 'union', count: projData.union },
        { type: 'surface', count: projData.surface }
      ].filter(d => d.count > 0);
    }
  }

  // helper function for rounding
  function round(value, precision) {
    var multiplier = Math.pow(10, precision || 0);
    return Math.round(value * multiplier) / multiplier;
  }

  const rateData = [
    { name: 'Accepted', value: activeAccepted, color: '#10b981' },
    { name: 'Refused', value: activeRefused, color: '#ef4444' },
    { name: 'Pending', value: activePending, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const monthlyData = stats?.monthly_trend || [];

  return (
    <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-1 flex flex-col gap-6 w-full pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">
            <span className="bg-gradient-to-r from-red-500 via-red-400 to-slate-300 bg-clip-text text-transparent">
              WeldSight Analytics Studio
            </span>
          </h2>
          <p className="text-xs text-slate-500">Aggregated NDT quality assessment indicators across active projects.</p>
        </div>
        
        {/* Dynamic Project Filter Dropdown */}
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Project Scope:</label>
          <select 
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-300 focus:outline-none focus:border-red-500 cursor-pointer"
          >
            {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Scans', value: activeTotal, color: 'text-white', bg: 'bg-red-500/10' },
          { label: 'Accepted Welds', value: activeAccepted, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Refused Welds', value: activeRefused, color: 'text-red-400', bg: 'bg-red-500/10' },
          { label: 'Acceptance Rate', value: `${activeRate}%`, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
        ].map((kpi, i) => (
          <div key={i} className="glass-card p-5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-16 h-16 ${kpi.bg} rounded-bl-full blur-xl`} />
            <h4 className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">{kpi.label}</h4>
            <div className={`text-3xl font-light font-mono ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Defect Distribution */}
        <div className="glass-card p-6 flex flex-col justify-between">
          <div>
            <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-4">Defect Classification Density</h4>
            {activeDefectData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-600 text-sm italic">No defects identified in project.</div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={activeDefectData.map((d,i)=>({...d, name:d.type, color:COLORS[i%COLORS.length]}))} dataKey="count" innerRadius={55} outerRadius={80} paddingAngle={4}>
                      {activeDefectData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {activeDefectData.length > 0 && (
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              {activeDefectData.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {d.type.replace('_', ' ')} ({d.count})
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Verdict Distribution */}
        <div className="glass-card p-6 flex flex-col justify-between">
          <div>
            <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-4">Structural Audit Verdicts</h4>
            {rateData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-slate-600 text-sm italic">No audit verdicts recorded yet.</div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={rateData} dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={4}>
                      {rateData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          {rateData.length > 0 && (
            <div className="flex flex-wrap justify-center gap-5 mt-4">
              {rateData.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: d.color }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Monthly Trend */}
        <div className="glass-card p-6 md:col-span-2">
          <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-4">Monthly Inspection Trend (Last 6 Months)</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="month" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                <RechartsTooltip cursor={{fill:'rgba(255,255,255,0.04)'}} contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: '#94a3b8', fontSize: '10px' }} itemStyle={{ color: '#ef4444', fontSize: '12px' }} />
                <Bar dataKey="count" name="Inspections" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Comparison Chart */}
        <div className="glass-card p-6 md:col-span-2">
          <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-6">Industrial Project Cross-Comparison</h4>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projectsList} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 5 }}>
                <XAxis type="number" stroke="#475569" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis dataKey="project_name" type="category" stroke="#94a3b8" fontSize={9} width={130} tickLine={false} axisLine={false} />
                <RechartsTooltip cursor={{fill:'rgba(255,255,255,0.02)'}} contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'bold' }} itemStyle={{ fontSize: '11px' }} />
                <Bar dataKey="total" name="Total Scans" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar dataKey="accepted" name="Accepted Welds" fill="#10b981" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Projects Data Table */}
        <div className="glass-card p-6 md:col-span-2 overflow-x-auto">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em]">Project Performance Matrix</h4>
            <span className="text-[10px] text-red-400 font-mono font-bold uppercase">4 Active Industrial Nodes</span>
          </div>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 uppercase tracking-widest text-[9px] font-black">
                <th className="py-3 px-2">Project Name</th>
                <th className="py-3 px-2">Client</th>
                <th className="py-3 px-2 text-center">Total Scans</th>
                <th className="py-3 px-2 text-center">Acceptance %</th>
                <th className="py-3 px-2 text-center text-red-400">Cracks</th>
                <th className="py-3 px-2 text-center text-blue-400">Volumetric</th>
                <th className="py-3 px-2 text-center text-orange-400">Lack of Union</th>
                <th className="py-3 px-2 text-center text-purple-400">Surface</th>
              </tr>
            </thead>
            <tbody>
              {projectsList.map((p, idx) => {
                const pRate = p.total ? round(p.accepted / p.total * 100, 1) : 0;
                return (
                  <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors font-mono">
                    <td className="py-3 px-2 font-bold text-white text-sans">{p.project_name}</td>
                    <td className="py-3 px-2 text-slate-400">{p.client_name}</td>
                    <td className="py-3 px-2 text-center font-bold text-slate-300">{p.total}</td>
                    <td className="py-3 px-2 text-center font-bold text-emerald-400">{pRate}%</td>
                    <td className="py-3 px-2 text-center text-red-500 font-bold">{p.cracks}</td>
                    <td className="py-3 px-2 text-center text-blue-400 font-bold">{p.volumetric}</td>
                    <td className="py-3 px-2 text-center text-orange-500 font-bold">{p.union}</td>
                    <td className="py-3 px-2 text-center text-purple-500 font-bold">{p.surface}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
};

// ─── Audit Log View (Admin Only) ────────────────────────────────────────────────
const AuditLogView = ({ API_URL }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_URL}/api/audit-log`);
        if (res.ok) setLogs(await res.json());
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchLogs();
    const iv = setInterval(fetchLogs, 10000);
    return () => clearInterval(iv);
  }, [API_URL]);

  const modelColors = {
    '4cls':  'text-red-400 bg-red-500/10 border-red-500/20',
    'qwen':  'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    'yolo':  'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'radio': 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  };

  return (
    <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex-1 flex flex-col gap-6 w-full">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">
            <span className="bg-gradient-to-r from-red-500 via-red-400 to-slate-300 bg-clip-text text-transparent">
              System Audit Log
            </span>
          </h2>
          <p className="text-xs text-slate-500">Full activity trail for all AI model usage. Admin access only.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Live — Auto refresh 10s</span>
        </div>
      </div>

      <div className="glass-card overflow-hidden border-white/5">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <div className="w-8 h-8 border-2 border-red-500/50 border-t-red-500 rounded-full animate-spin mr-4" />
            Loading audit log...
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 text-slate-600 text-sm italic">No activity recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  {['Time', 'User', 'IP Address', 'Action', 'Model'].map(h => (
                    <th key={h} className="px-5 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((l, i) => (
                  <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-mono text-[11px] text-slate-500">{l.time}</td>
                    <td className="px-5 py-3 text-sm font-bold text-white">{l.username}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{l.ip}</td>
                    <td className="px-5 py-3 text-xs text-slate-300">{l.action}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-black px-2 py-1 rounded border ${modelColors[l.model] || 'text-slate-400 bg-white/5 border-white/10'}`}>
                        {l.model?.toUpperCase() || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const API_URL = import.meta.env.VITE_API_URL || 
  ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? "http://localhost:8000" 
    : window.location.origin.replace(/:[0-9]+$/, ':8000'));

export default function App() {


  // === Auth & Login State (declared first) ===
  const [userId, setUserId] = useState(() => localStorage.getItem('user_id') || '');
  const [userRole, setUserRole] = useState(() => localStorage.getItem('user_role') || '');
  const [userIp, setUserIp] = useState('Detecting...');
  const [showLogin, setShowLogin] = useState(!localStorage.getItem('user_id'));
  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  // === App State ===
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedTraffic, setSelectedTraffic] = useState(null);
  const [isTrafficModalOpen, setIsTrafficModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detections, setDetections] = useState([]);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showChat, setShowChat] = useState(() => localStorage.getItem('chat_panel_open') === 'true');
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [inspections, setInspections] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisModel, setAnalysisModel] = useState('Auto-Detect');
  const [rtModelClass, setRtModelClass] = useState('4cls');
  const [vtModelClass, setVtModelClass] = useState('4cls');
  const [currentModelUsed, setCurrentModelUsed] = useState('');
  const [modelClassNames, setModelClassNames] = useState([]);

  // Chat History State
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('inspection_chats');
    return saved ? JSON.parse(saved) : [{ id: Date.now(), title: "New Inspection Chat", messages: [] }];
  });
  const [currentChatId, setCurrentChatId] = useState(() => {
    const saved = localStorage.getItem('current_chat_id');
    return saved ? parseInt(saved) : chats[0]?.id;
  });
  const [showHistoryList, setShowHistoryList] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [typingChatId, setTypingChatId] = useState(null);
  const stopTypingRef = useRef(false);
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);

  const currentChat = chats.find(c => c.id === currentChatId) || chats[0];

  // Persistence
  useEffect(() => {
    localStorage.setItem('inspection_chats', JSON.stringify(chats));
  }, [chats]);

  // Sync current chat to DB only when it changes
  useEffect(() => {
    if (!currentChat) return;
    const syncCurrentChat = async () => {
      try {
        const payload = { ...currentChat, username: userId || "Anonymous" };
        await fetch(`${API_URL}/api/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-user-id": userId || "Anonymous" },
          body: JSON.stringify(payload)
        });
      } catch (e) { console.error("DB Sync Error:", e); }
    };
    syncCurrentChat();
  }, [currentChat?.messages]);

  useEffect(() => {
    localStorage.setItem('current_chat_id', currentChatId);
  }, [currentChatId]);

  useEffect(() => {
    localStorage.setItem('chat_panel_open', showChat);
  }, [showChat]);



  const [globalStats, setGlobalStats] = useState([]);
  const [users, setUsers] = useState([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(res => res.json())
      .then(data => setUserIp(data.ip))
      .catch(() => setUserIp('127.0.0.1'));
  }, []);

  const [yoloLatency, setYoloLatency] = useState(0);
  const [radioLatency, setRadioLatency] = useState(0);
  const [qwenLatency, setQwenLatency] = useState(0);
  const [yoloHistory, setYoloHistory] = useState(Array(24).fill(0));
  const [radioHistory, setRadioHistory] = useState(Array(24).fill(0));
  const [qwenHistory, setQwenHistory] = useState(Array(24).fill(0));

  const [currentInspectionId, setCurrentInspectionId] = useState(null);
  const [currentInspectionDecision, setCurrentInspectionDecision] = useState(null);
  const [reportNotes, setReportNotes] = useState("");
  const [weldForm, setWeldForm] = useState({
    project_name: '',
    client_name: '',
    weld_id: '',
    thickness_mm: '',
    standard: 'EN 1435',
    material: 'Carbon Steel',
  });

  const loadDataForUser = async () => {
    // We allow fetching even if userId is empty (Anonymous mode)
    try {
      const resChats = await fetch(`${API_URL}/api/chats`, {
        headers: { 
          "x-user-id": userId || "Anonymous", 
          "x-user-role": userRole || "Inspector" 
        }
      });
      if (resChats.ok) {
        const dbChats = await resChats.json();
        if (dbChats.length > 0) setChats(dbChats);
      }
    } catch (e) { console.error("DB Chat Load Error:", e); }

    try {
      const resInsp = await fetch(`${API_URL}/api/inspections`, {
        headers: {
          "x-user-id": userId || "Anonymous",
          "x-user-role": userRole || "Inspector"
        }
      });
      if (resInsp.ok) {
        const dbInsp = await resInsp.json();
        setInspections(dbInsp);
      }
    } catch (e) { console.error("DB Insp Load Error:", e); }
  };

  useEffect(() => {
    loadDataForUser();
  }, [userId, userRole]);

  const fetchData = async () => {
    try {
      const start = Date.now();
      const statsRes = await fetch(`${API_URL}/api/global-stats`);
      const end = Date.now();
      
      if (statsRes.ok) {
        setGlobalStats(await statsRes.json());
        
        // Base network latency
        const baseLat = end - start;
        
        // Simulate realistic slight inference routing variations
        const yLat = baseLat + Math.floor(Math.random() * 15);
        const rLat = baseLat + Math.floor(Math.random() * 12);
        const qLat = baseLat + Math.floor(Math.random() * 10);
        
        setYoloLatency(yLat);
        setRadioLatency(rLat);
        setQwenLatency(qLat);
        setYoloHistory(prev => [...prev.slice(1), yLat]);
        setRadioHistory(prev => [...prev.slice(1), rLat]);
        setQwenHistory(prev => [...prev.slice(1), qLat]);
      }

      const userRes = await fetch(`${API_URL}/api/users`);
      if (userRes.ok) setUsers(await userRes.json());
    } catch (e) { console.error("Sync Error:", e); }
    finally { setLoadingHistory(false); }
  };

  const handleLogin = async () => {
    if (!loginInput.trim() || !passwordInput.trim()) { setLoginError('Enter username and password.'); return; }
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginInput, password: passwordInput })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('user_id', data.username);
        localStorage.setItem('user_role', data.role || 'Inspector');
        setUserId(data.username);
        setUserRole(data.role || 'Inspector');
        setShowLogin(false);
        fetchData();
      } else {
        const err = await res.json();
        setLoginError(err.detail || 'Login failed.');
      }
    } catch (e) { 
      console.error("Login error:", e);
      setLoginError('Connection error.'); 
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRegister = async () => {
    if (!loginInput.trim() || !passwordInput.trim()) { setLoginError('Enter username and password.'); return; }
    setLoginError('');
    setIsLoggingIn(true);
    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginInput, password: passwordInput, role: "Inspector" })
      });
      if (res.ok) {
        // After registration, log them in
        handleLogin();
      } else {
        const err = await res.json();
        setLoginError(err.detail || 'Registration failed.');
      }
    } catch (e) { 
      console.error("Registration error:", e);
      setLoginError('Connection error.'); 
    } finally {
      setIsLoggingIn(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showChat && isAtBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [showChat, currentChat.messages, typingChatId]);


  const handleChatScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAtBottomRef.current = atBottom;
  };
  
  const imgRef = useRef(null);
  const [viewBox, setViewBox] = useState("0 0 100 100");

  const handleImageSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file) {
        setImageFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreview(reader.result);
        };
        reader.readAsDataURL(file);
        setDetections([]);
      }
    }
  };

  const handleImageLoad = () => {
    if (imgRef.current) {
      setViewBox(`0 0 ${imgRef.current.naturalWidth} ${imgRef.current.naturalHeight}`);
    }
  };

  const runAnalysis = async () => {
    if (!imageFile || isProcessing) return;

    setIsProcessing(true);
    setDetections([]);

    try {
      // ── WeldSight inference via /api/analyze with model_type & inspection_type ──
      const formData = new FormData();
      formData.append("file", imageFile);

      // Map UI selection to API query params
      const inspectionTypeParam = analysisModel === 'Visual (Photo)' ? 'visual' : analysisModel === 'Radiographic (X-Ray)' ? 'radio' : 'auto';
      const modelTypeParam = analysisModel === 'Visual (Photo)' ? (vtModelClass || '4cls') : (rtModelClass || '4cls');

      const res = await fetch(`${API_URL}/api/analyze?model_type=${modelTypeParam}&inspection_type=${inspectionTypeParam}`, {
        method: "POST",
        headers: { 
          "x-user-id": userId || "Anonymous"
        },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${res.status}`);
      }

      const responseData = await res.json();
      const newDetections = Array.isArray(responseData.detections) ? responseData.detections : [];
      const modelUsed = responseData.model_used || "WeldSight-4CLS";
      setDetections(newDetections);
      setCurrentModelUsed(modelUsed);
      if (Array.isArray(responseData.class_names)) {
        setModelClassNames(responseData.class_names);
      }

      // Auto-trigger AI summary
      const boxes_found = newDetections.filter(d => d.type === "box");

      // Save to DB
      try {
        const newRecord = {
          id: Date.now(),
          timestamp: new Date().toLocaleString(),
          image: imagePreview,
          detections: newDetections,
          username: userId || "Anonymous",
          decision: null,
          model_used: modelUsed,
          project_name: weldForm.project_name || "Sonatrach Pipeline A",
          client_name: weldForm.client_name || "Sonatrach",
          weld_id: weldForm.weld_id || `W-${Date.now().toString().slice(-6)}`,
          thickness_mm: parseFloat(weldForm.thickness_mm) || 12.5,
          standard: weldForm.standard || "EN 1435",
          material: weldForm.material || "Carbon Steel",
        };
        setCurrentInspectionId(newRecord.id);
        setCurrentInspectionDecision(null);

        fetch(`${API_URL}/api/inspections`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": userId || "Anonymous",
            "x-user-role": userRole || "Inspector"
          },
          body: JSON.stringify(newRecord)
        });
        setInspections(prev => [newRecord, ...prev]);
      } catch (e) { console.error("Inspection Save Error:", e); }

      triggerAISummary(boxes_found, currentChatId, currentChat.messages);
    } catch (error) {
      console.error(error);
      alert("Analysis Error: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecision = async (decision) => {
    if (!currentInspectionId) return;
    setCurrentInspectionDecision(decision);
    setReportNotes(`Weld quality analysis reveals structural integrity meets required standards for ${decision.toLowerCase()} status.\n\nPrimary Findings:\n- Total Defects: ${detections.filter(d => d.type === 'box').length}\n- Inspector Verdict: ${decision.toUpperCase()}\n\nRecommendation:\n[Please enter final engineer recommendation here]`);
    setActiveTab('Report');
    
    try {
      await fetch(`${API_URL}/api/inspections/${currentInspectionId}`, {
        method: "PATCH",
        headers: { 
          "Content-Type": "application/json",
          "x-user-id": userId || "Anonymous",
          "x-user-role": userRole || "Inspector"
        },
        body: JSON.stringify({ decision })
      });
      
      // Update local history
      setInspections(prev => prev.map(insp => 
        insp.id === currentInspectionId ? { ...insp, decision } : insp
      ));
    } catch (e) {
      console.error("Decision Update Error:", e);
    }
  };

  const generatePDFReport = (decision, inspId, detections, notes) => {
    const doc = new jsPDF();
    const timestamp = new Date();
    const formattedDate = timestamp.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const boxes = detections.filter(d => d.type === 'box');
    const finalDecision = decision || 'PENDING';

    // 1. Header (Slate 900)
    doc.setFillColor(15, 23, 42); // Slate 900
    doc.rect(0, 0, 210, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont(undefined, 'bold');
    doc.text("Quality Inspection Rapport", 15, 25);
    
    doc.setFontSize(8);
    doc.setTextColor(239, 68, 68); // Red 500
    doc.text("INDUSTRIAL AI AUDIT TRAIL", 15, 33);
    doc.setTextColor(150, 150, 150);
    doc.text("| CONFIDENTIAL DOCUMENT", 55, 33);

    // Rapport Reference (Top Right)
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(7);
    doc.text("RAPPORT REFERENCE", 160, 20);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(`# ${String(inspId || '').slice(-8).toUpperCase()}`, 160, 26);

    // 2. Meta Grid (3 Columns)
    let curY = 55;
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.setFontSize(7);
    doc.text("PRIMARY INSPECTOR", 15, curY);
    doc.text("ANALYSIS DATE", 80, curY);
    doc.text("FINAL VERDICT", 145, curY);

    curY += 6;
    doc.setTextColor(30, 41, 59); // Slate 800
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(userId || 'Anonymous User', 15, curY);
    doc.text(formattedDate, 80, curY);
    
    const verdictColor = finalDecision === 'Accepted' ? [16, 185, 129] : (finalDecision === 'Refused' ? [239, 68, 68] : [100, 116, 139]);
    doc.setTextColor(...verdictColor);
    doc.text(finalDecision.toUpperCase(), 145, curY);

    // Divider line
    curY += 8;
    doc.setDrawColor(241, 245, 249); // Slate 100
    doc.line(15, curY, 195, curY);

    // 3. Section I: Neural Image
    curY += 15;
    doc.setDrawColor(239, 68, 68); // Red
    doc.setLineWidth(1.5);
    doc.line(15, curY - 3, 15, curY + 2);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text("I. NEURAL IMAGE CAPTURE", 20, curY);

    curY += 8;
    if (imagePreview) {
      try {
        const imgWidth = 180;
        const imgHeight = 90;
        doc.addImage(imagePreview, 'JPEG', 15, curY, imgWidth, imgHeight);
        
        // Annotated Masks (Polygons)
        if (imgRef.current) {
          const natW = imgRef.current.naturalWidth;
          const natH = imgRef.current.naturalHeight;
          const scaleX = imgWidth / natW;
          const scaleY = imgHeight / natH;

          const masks = detections.filter(d => d.type === 'mask');
          masks.forEach((mask, idx) => {
            if (mask.points && mask.points.length > 2) {
              const colorObj = getColorForLabel(mask.label);
              const [r, g, b] = colorObj.rgb.split(',').map(Number);
              
              doc.setDrawColor(r, g, b);
              doc.setLineWidth(0.2);
              
              const pts = mask.points.map(p => [p[0] * scaleX, p[1] * scaleY]);
              
              // Draw filled polygon
              doc.setFillColor(r, g, b);
              doc.setAlpha(0.3); // Semi-transparent fill
              
              // We'll use doc.polygon for a filled shape
              // doc.polygon(points, style) - points is array of {x, y}
              const polyPoints = pts.map(p => ({ x: 15 + p[0], y: curY + p[1] }));
              doc.polygon(polyPoints, 'F');
              
              doc.setAlpha(1); // Reset alpha
              doc.setDrawColor(r, g, b);
              doc.setLineWidth(0.1);
              doc.polygon(polyPoints, 'S'); // Optional subtle stroke for definition

              doc.setTextColor(r, g, b);
              doc.setFontSize(4);
              doc.text(`#${idx + 1} ${mask.label.toUpperCase()}`, 15 + pts[0][0], curY + pts[0][1] - 1);
            }
          });
        }
        curY += imgHeight + 15;
      } catch (e) { curY += 10; }
    }

    // 4. Section II: Analysis Matrix
    if (curY > 250) { doc.addPage(); curY = 25; }
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(1.5);
    doc.line(15, curY - 3, 15, curY + 2);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text("II. AI ANALYSIS MATRIX", 20, curY);

    curY += 8;
    doc.setFillColor(248, 250, 252); // Slate 50
    doc.rect(15, curY, 180, 8, 'F');
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text("CLASSIFICATION", 20, curY + 5);
    doc.text("ISO STANDARD & EXPLICATION", 70, curY + 5);
    doc.text("CONFIDENCE", 175, curY + 5);

    curY += 8;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(30, 41, 59);
    if (boxes.length === 0) {
      doc.text("No defects detected. System verified clear.", 20, curY + 10);
      curY += 15;
    } else {
      boxes.forEach(det => {
        curY += 10;
        if (curY > 270) { doc.addPage(); curY = 25; }
        const data = DEFECT_STANDARDS[det.label.toLowerCase()] || DEFECT_STANDARDS['defect'];
        
        doc.setFont(undefined, 'bold');
        doc.setFontSize(8);
        doc.text(det.label.toUpperCase(), 20, curY);
        
        doc.setTextColor(239, 68, 68);
        doc.setFontSize(7);
        doc.text(data.std, 70, curY);
        
        doc.setTextColor(71, 85, 105);
        doc.setFont(undefined, 'italic');
        doc.setFontSize(7);
        const splitDesc = doc.splitTextToSize(data.desc, 90);
        doc.text(splitDesc, 70, curY + 4);
        
        doc.setTextColor(30, 41, 59);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.text(`${(det.confidence * 100).toFixed(1)}%`, 175, curY);
        
        curY += 6;
      });
      curY += 10;
    }

    // 5. Section III: Inspector Observations
    if (curY > 240) { doc.addPage(); curY = 25; }
    curY += 10;
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(1.5);
    doc.line(15, curY - 3, 15, curY + 2);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text("III. INSPECTOR OBSERVATIONS", 20, curY);

    curY += 8;
    doc.setFillColor(248, 250, 252);
    doc.rect(15, curY, 180, 40, 'F');
    doc.setTextColor(71, 85, 105); // Slate 600
    doc.setFont(undefined, 'italic');
    doc.setFontSize(8);
    const splitNotes = doc.splitTextToSize(notes || 'No observations recorded.', 170);
    doc.text(splitNotes, 20, curY + 8);

    // 6. Footer
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(6);
    doc.setFont(undefined, 'bold');
    doc.text("GENERATED BY INDUSTRIAL INSPECTION HUB AI SYSTEM", 15, 285);
    doc.text(`DIGITAL SIGNATURE: ${String(inspId || '').slice(0, 16)}`, 15, 288);

    doc.save(`Inspection_Report_${inspId}.pdf`);
  };

  const triggerAISummary = async (foundBoxes, targetChatId, targetMessages) => {
    console.log("Triggering AI Summary for chat:", targetChatId);
    setTypingChatId(targetChatId);

    try {
      const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
      const mmPerPx = 150 / imageWidthPx;
      
      let summaryContext = "";
      if (foundBoxes.length > 0) {
        summaryContext = `The automated inspection has completed. I have identified ${foundBoxes.length} items for review: \n`;
        foundBoxes.forEach(d => {
          const sizeMm = (Math.max(d.xyxy[2]-d.xyxy[0], d.xyxy[3]-d.xyxy[1]) * mmPerPx).toFixed(1);
          summaryContext += `- ${d.label} (${sizeMm}mm, ${(d.confidence*100).toFixed(0)}% confidence)\n`;
        });
        summaryContext += `\nBriefly acknowledge these findings and ask if I would like a detailed technical analysis or if you should evaluate them against international standards. Do NOT provide the full analysis yet.`;
      } else {
        summaryContext = `The automated inspection has completed and NO defects were detected. The image appears clear according to the current neural model thresholds. Briefly report that everything looks clear and ask if I have any specific areas I'd like you to double-check manually.`;
      }

      const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${import.meta.env.VITE_HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-72B-Instruct",
          messages: [
            { role: "system", content: "You are a Senior Industrial Quality Engineer. Your initial response to new detections must be brief: list the findings and ask if the user wants a detailed technical evaluation. Only provide detailed ISO/ASME/AWS analysis when specifically asked in the follow-up." },
            ...targetMessages.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: summaryContext }
          ],
          max_tokens: 500,
        })
      });

      if (!response.ok) throw new Error("API Response Error: " + response.status);

      const data = await response.json();
      const assistantContent = data.choices[0].message.content;
      
      // Typewriter Effect for Summary
      let displayedContent = "";
      const words = assistantContent.split(" ");
      
      // Create an empty message slot first
      const msgId = Date.now();
      setChats(prev => prev.map(c => 
        c.id === targetChatId 
          ? { ...c, messages: [...c.messages, { id: msgId, role: "assistant", content: "" }] }
          : c
      ));

      stopTypingRef.current = false;
      for (let i = 0; i < words.length; i++) {
        if (stopTypingRef.current) {
          console.log("Typing aborted by user.");
          break;
        }
        displayedContent += (i === 0 ? "" : " ") + words[i];
        setChats(prev => prev.map(c => 
          c.id === targetChatId 
            ? {
                ...c,
                messages: c.messages.map(m => m.id === msgId ? { ...m, content: displayedContent } : m)
              }
            : c
        ));
        await new Promise(r => setTimeout(r, 60)); // Delay per word (slower)
      }
      stopTypingRef.current = false;

      // if (!showChat) setShowChat(true); // User requested not to open automatically
    } catch (e) {
      console.error("AI Summary Error:", e);
    } finally {
      setTypingChatId(null);
    }
  };

  const boxes = detections.filter(d => d.type === "box");
  const masks = detections.filter(d => d.type === "mask");

  const sendMessage = async (overrideInput = null) => {
    const inputToUse = overrideInput || chatInput;
    if (!inputToUse.trim() || typingChatId) return;
    
    const userMsg = { role: "user", content: inputToUse };
    
    // Update local state first
    setChats(prev => prev.map(c => 
      c.id === currentChatId 
        ? { ...c, messages: [...c.messages, userMsg] }
        : c
    ));
    if (!overrideInput) setChatInput("");
    setTypingChatId(currentChatId);

    // ONLY log usage here, when the USER sends a message
    fetch(`${API_URL}/api/log-usage/qwen`, {
      method: "POST",
      headers: { "x-user-id": userId || "Anonymous" }
    });

    try {
      const isGreeting = /^(hi|hello|hey|greetings|morning|afternoon|evening)/i.test(inputToUse.trim());
      
      let systemPrompt = "You are a Senior Industrial Quality Engineer. Be professional and technical. ";
      if (isGreeting) {
        systemPrompt += "The user is just greeting you. Respond naturally and politely, and mention you are ready to analyze any inspection data.";
      } else {
        systemPrompt += "Reference international standards (ISO, AWS, ASME) only when relevant. If the user asks about the detections, refer to this data: \n";
        boxes.forEach((d) => {
          const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
          const mmPerPx = 150 / imageWidthPx;
          const w = d.xyxy[2] - d.xyxy[0];
          const h = d.xyxy[3] - d.xyxy[1];
          const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);
          systemPrompt += `- ${d.label} (${sizeMm}mm, confidence: ${(d.confidence*100).toFixed(1)}%)\n`;
        });
      }

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...currentChat.messages.map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: inputToUse }
      ];

      let assistantContent = "";
      try {
        const response = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: inputToUse,
            detections: boxes
          })
        });
        if (response.ok) {
          const data = await response.json();
          assistantContent = data.response;
        } else {
          throw new Error("Local chat failed");
        }
      } catch (err) {
        console.warn("Local chat fallback to Hugging Face:", err);
        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${import.meta.env.VITE_HF_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "Qwen/Qwen2.5-72B-Instruct",
            messages: apiMessages,
            max_tokens: 1000,
          })
        });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const data = await response.json();
        assistantContent = data.choices[0].message.content;
      }

      // Typewriter Effect for manual message
      let displayedContent = "";
      const words = assistantContent.split(" ");
      const msgId = Date.now();
      
      setChats(prev => prev.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: [...c.messages, { id: msgId, role: "assistant", content: "" }] }
          : c
      ));

      stopTypingRef.current = false;
      for (let i = 0; i < words.length; i++) {
        if (stopTypingRef.current) {
          console.log("Typing aborted by user.");
          break;
        }
        displayedContent += (i === 0 ? "" : " ") + words[i];
        setChats(prev => prev.map(c => 
          c.id === currentChatId 
            ? {
                ...c,
                messages: c.messages.map(m => m.id === msgId ? { ...m, content: displayedContent } : m)
              }
            : c
        ));
        await new Promise(r => setTimeout(r, 50));
      }
      stopTypingRef.current = false;

    } catch (error) {
      console.error(error);
      setChats(prev => prev.map(c => 
        c.id === currentChatId 
          ? { ...c, messages: [...c.messages, { role: "assistant", content: "Error: Unable to connect to Expert AI. Please verify your connection." }] }
          : c
      ));
    } finally {
      setTypingChatId(null);
    }
  };

  const startNewChat = () => {
    const newChat = {
      id: Date.now(),
      title: `Scan ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
      messages: [],
      username: userId || "Anonymous"
    };
    setChats(prev => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setShowHistoryList(false);
  };

  const deleteChat = (id, e) => {
    e.stopPropagation();
    fetch(`${API_URL}/api/chats/${id}`, { 
      method: 'DELETE',
      headers: {
        "x-user-id": userId || "Anonymous",
        "x-user-role": userRole || "Inspector"
      }
    }).catch(console.error);
    
    if (chats.length === 1) {
      setChats([{ id: Date.now(), title: "New Chat", messages: [], username: userId || "Anonymous" }]);
      return;
    }
    const newChats = chats.filter(c => c.id !== id);
    setChats(newChats);
    if (currentChatId === id) {
      setCurrentChatId(newChats[0].id);
    }
  };

  const focusOnDefect = async (det) => {
    if (typingChatId) return;
    
    const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
    const mmPerPx = 150 / imageWidthPx;
    const w = det.xyxy[2] - det.xyxy[0];
    const h = det.xyxy[3] - det.xyxy[1];
    const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);

    const focusQuery = `I want to focus on this specific defect: ${det.label.replace('_', ' ')}. It measures approximately ${sizeMm}mm with a confidence of ${(det.confidence*100).toFixed(1)}%. Please provide a detailed technical evaluation for ONLY this item.`;
    
    setChatInput(focusQuery);
    if (!showChat) setShowChat(true);
    // Auto-send the focus query
    setTimeout(() => {
      sendMessage(focusQuery);
    }, 100);
  };

  return (
    <BrowserRouter>
      <AppContent 
        {...{
          userId, setUserId, userRole, setUserRole, userIp, showLogin, setShowLogin, loginInput, setLoginInput, passwordInput, setPasswordInput, loginError, setLoginError, handleLogin,
          imagePreview, setImagePreview, detections, setDetections, isDragging, setIsDragging, isAnalyzing, setIsAnalyzing, 
          currentInspectionId, setCurrentInspectionId, currentInspectionDecision, setCurrentInspectionDecision, reportNotes, setReportNotes, 
          globalStats, setGlobalStats, users, setUsers, inspections, setInspections, loadingHistory, setLoadingHistory,
          showChat, setShowChat, isMobileMenuOpen, setIsMobileMenuOpen, imgRef, handleImageLoad, viewBox,
          getColorForLabel, triggerAISummary, generatePDFReport, sendMessage, DEFECT_STANDARDS, API_URL, isProcessing,
          yoloLatency, radioLatency, qwenLatency, yoloHistory, radioHistory, qwenHistory, showAnnotations, setShowAnnotations, imageFile, setImageFile, runAnalysis, handleImageSelect, focusOnDefect, masks, boxes,
          analysisModel, setAnalysisModel, rtModelClass, setRtModelClass, vtModelClass, setVtModelClass, currentModelUsed, setCurrentModelUsed, modelClassNames, setModelClassNames,
          isTrafficModalOpen, setIsTrafficModalOpen, selectedTraffic, setSelectedTraffic, chats, setChats, currentChatId, setCurrentChatId, showHistoryList, setShowHistoryList, 
          chatInput, setChatInput, typingChatId, setTypingChatId, stopTypingRef, chatEndRef, chatContainerRef, isAtBottomRef, currentChat, handleChatScroll, startNewChat, deleteChat, handleDecision,
          isRegisterMode, setIsRegisterMode, handleRegister,
          isLoggingIn, setIsLoggingIn,
          weldForm, setWeldForm
        }}
      />
    </BrowserRouter>
  );
}

function AppContent({
  userId, setUserId, userRole, setUserRole, userIp, showLogin, setShowLogin, loginInput, setLoginInput, passwordInput, setPasswordInput, loginError, setLoginError, handleLogin,
  imagePreview, setImagePreview, detections, setDetections, isDragging, setIsDragging, isAnalyzing, setIsAnalyzing, 
  currentInspectionId, setCurrentInspectionId, currentInspectionDecision, setCurrentInspectionDecision, reportNotes, setReportNotes, 
  globalStats, setGlobalStats, users, setUsers, inspections, setInspections, loadingHistory, setLoadingHistory,
  showChat, setShowChat, isMobileMenuOpen, setIsMobileMenuOpen, imgRef, handleImageLoad, viewBox,
  getColorForLabel, triggerAISummary, generatePDFReport, sendMessage, DEFECT_STANDARDS, API_URL, isProcessing,
  yoloLatency, radioLatency, qwenLatency, yoloHistory, radioHistory, qwenHistory, showAnnotations, setShowAnnotations, imageFile, setImageFile, runAnalysis, handleImageSelect, focusOnDefect, masks, boxes,
  analysisModel, setAnalysisModel, rtModelClass, setRtModelClass, vtModelClass, setVtModelClass, currentModelUsed, setCurrentModelUsed, modelClassNames, setModelClassNames,
  isTrafficModalOpen, setIsTrafficModalOpen, selectedTraffic, setSelectedTraffic, chats, setChats, currentChatId, setCurrentChatId, showHistoryList, setShowHistoryList, 
  chatInput, setChatInput, typingChatId, setTypingChatId, stopTypingRef, chatEndRef, chatContainerRef, isAtBottomRef, currentChat, handleChatScroll, startNewChat, deleteChat, handleDecision,
  isRegisterMode, setIsRegisterMode, handleRegister,
  isLoggingIn, setIsLoggingIn,
  weldForm, setWeldForm
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [confThreshold, setConfThreshold] = useState(0.40); // Default NDT threshold 40%

  // Correction Studio States & Refs
  const [isRetrainStudioOpen, setIsRetrainStudioOpen] = useState(false);
  const [retrainBoxes, setRetrainBoxes] = useState([]);
  const [retrainIsDrawing, setRetrainIsDrawing] = useState(false);
  const [retrainStartPos, setRetrainStartPos] = useState({ x: 0, y: 0 });
  const [retrainCurrentPos, setRetrainCurrentPos] = useState({ x: 0, y: 0 });
  const [retrainClass, setRetrainClass] = useState("porosity");
  const [isSavingRetrain, setIsSavingRetrain] = useState(false);
  const [retrainDrawMode, setRetrainDrawMode] = useState("box"); // 'box' or 'segment'
  const [retrainPoints, setRetrainPoints] = useState([]); // Array of [x, y] for segment mode
  const [retrainViewBox, setRetrainViewBox] = useState("0 0 640 480");
  const retrainSvgRef = useRef(null);

  const openRetrainStudio = () => {
    const sourceDetections = isVisualInspection ? filteredMasks : filteredBoxes;
    setRetrainBoxes(sourceDetections.map(det => ({ ...det, hidden: false })));
    
    // Set default class based on the chosen model's classes
    const activeClasses = getRetrainClasses();
    if (activeClasses && activeClasses.length > 0) {
      setRetrainClass(activeClasses[0].id);
    } else {
      setRetrainClass("porosity");
    }
    
    setRetrainDrawMode(isVisualInspection ? "segment" : "box");
    setIsRetrainStudioOpen(true);
  };

  const handleRetrainMouseDown = (e) => {
    const svg = retrainSvgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    
    setRetrainIsDrawing(true);
    setRetrainStartPos({ x: svgP.x, y: svgP.y });
    setRetrainCurrentPos({ x: svgP.x, y: svgP.y });
    if (retrainDrawMode === 'segment') {
      setRetrainPoints([[svgP.x, svgP.y]]);
    }
  };

  const handleRetrainMouseMove = (e) => {
    if (!retrainIsDrawing) return;
    const svg = retrainSvgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    
    setRetrainCurrentPos({ x: svgP.x, y: svgP.y });
    if (retrainDrawMode === 'segment') {
      setRetrainPoints(pts => [...pts, [svgP.x, svgP.y]]);
    }
  };

  const handleRetrainMouseUp = () => {
    if (!retrainIsDrawing) return;
    setRetrainIsDrawing(false);
    
    if (retrainDrawMode === "segment") {
      if (retrainPoints.length >= 3) {
        const xs = retrainPoints.map(p => p[0]);
        const ys = retrainPoints.map(p => p[1]);
        const x1 = Math.min(...xs);
        const y1 = Math.min(...ys);
        const x2 = Math.max(...xs);
        const y2 = Math.max(...ys);
        
        const newBox = {
          type: "mask",
          label: retrainClass,
          confidence: 1.0,
          points: retrainPoints,
          xyxy: [x1, y1, x2, y2],
          hidden: false
        };
        setRetrainBoxes(prev => [...prev, newBox]);
      }
      setRetrainPoints([]);
    } else {
      const x1 = Math.min(retrainStartPos.x, retrainCurrentPos.x);
      const y1 = Math.min(retrainStartPos.y, retrainCurrentPos.y);
      const x2 = Math.max(retrainStartPos.x, retrainCurrentPos.x);
      const y2 = Math.max(retrainStartPos.y, retrainCurrentPos.y);
      
      const w = x2 - x1;
      const h = y2 - y1;
      
      if (w > 5 && h > 5) {
        const newBox = {
          type: "box",
          label: retrainClass,
          confidence: 1.0,
          xyxy: [x1, y1, x2, y2],
          hidden: false
        };
        setRetrainBoxes(prev => [...prev, newBox]);
      }
    }
  };

  const deleteRetrainBox = (idxToDelete) => {
    setRetrainBoxes(prev => prev.filter((_, idx) => idx !== idxToDelete));
  };

  const toggleHideRetrainBox = (idxToToggle) => {
    setRetrainBoxes(prev => prev.map((box, idx) => 
      idx === idxToToggle ? { ...box, hidden: !box.hidden } : box
    ));
  };

  const closeRetrainStudioWithSync = () => {
    const newDetections = [];
    retrainBoxes.forEach(item => {
      if (item.hidden) return;
      
      if (item.type === 'mask') {
        newDetections.push({
          ...item,
          confidence: item.confidence ?? 1.0
        });
        
        if (item.xyxy) {
          newDetections.push({
            type: 'box',
            label: item.label,
            confidence: item.confidence ?? 1.0,
            xyxy: item.xyxy
          });
        }
      } else {
        newDetections.push({
          ...item,
          confidence: item.confidence ?? 1.0
        });
        
        if (isVisualInspection && item.xyxy) {
          const [x1, y1, x2, y2] = item.xyxy;
          const points = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2]
          ];
          newDetections.push({
            type: 'mask',
            label: item.label,
            confidence: item.confidence ?? 1.0,
            points: points,
            xyxy: item.xyxy
          });
        }
      }
    });
    setDetections(newDetections);
    setIsRetrainStudioOpen(false);
  };

  const saveRetrainData = async () => {
    setIsSavingRetrain(true);
    try {
      const payload = {
        image_base64: imagePreview,
        filename: imageFile ? imageFile.name : "corrected_image.jpg",
        labels: retrainBoxes.map(box => ({
          label: box.label,
          xyxy: box.xyxy,
          points: box.points
        }))
      };
      
      const res = await fetch(`${API_URL}/api/retrain/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId || 'Anonymous',
          'x-user-role': userRole || 'Inspector'
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert("Retraining data saved successfully!");
        closeRetrainStudioWithSync();
      } else {
        alert("Failed to save retraining data.");
      }
    } catch (err) {
      console.error("Error saving retraining data:", err);
      alert("Error saving retraining data.");
    } finally {
      setIsSavingRetrain(false);
    }
  };

  const handleRetrainImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    setRetrainViewBox(`0 0 ${naturalWidth} ${naturalHeight}`);
  };

  // Dynamic real-time filter for active scan and report PDF preview
  const filteredDetections = (detections || []).filter(d => (d.confidence ?? 1.0) >= confThreshold);
  const filteredBoxes = filteredDetections.filter(d => d.type === 'box');
  const filteredMasks = filteredDetections.filter(d => d.type === 'mask');
  const isVisualInspection = analysisModel === 'Visual (Photo)' || 
    (analysisModel === 'Auto-Detect' && (
      currentModelUsed.toLowerCase().includes('visual') || 
      currentModelUsed.toLowerCase().includes('vt')
    ));

  const getRetrainClasses = () => {
    // If the backend returned actual class names, use them directly
    if (modelClassNames && modelClassNames.length > 0) {
      const dynamicPalette = [
        { color: "#ef4444", rgb: "239,68,68" },
        { color: "#3b82f6", rgb: "59,130,246" },
        { color: "#10b981", rgb: "16,185,129" },
        { color: "#f59e0b", rgb: "245,158,11" },
        { color: "#8b5cf6", rgb: "139,92,246" },
        { color: "#ec4899", rgb: "236,72,153" },
        { color: "#14b8a6", rgb: "20,184,166" },
        { color: "#64748b", rgb: "100,116,139" }
      ];
      return modelClassNames.map((name, i) => {
        // Try to find a matching entry in the master lookup table
        const existing = RETRAIN_CLASSES.find(c => c.id === name);
        const pal = dynamicPalette[i % dynamicPalette.length];
        return {
          id: name,
          name: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          color: existing ? existing.color : pal.color,
          rgb: existing ? existing.rgb : pal.rgb
        };
      });
    }

    // Fallback: use hardcoded defaults based on model selection
    if (isVisualInspection) {
      if (vtModelClass === 'binary') {
        return [
          { id: "defect", name: "Defect", color: "#ef4444", rgb: "239,68,68" },
          { id: "good_weld", name: "Good Weld", color: "#10b981", rgb: "16,185,129" }
        ];
      } else {
        return [
          { id: "crack", name: "Crack", color: "#ef4444", rgb: "239,68,68" },
          { id: "good_weld", name: "Good Weld", color: "#10b981", rgb: "16,185,129" },
          { id: "bad_weld", name: "Bad Weld", color: "#f59e0b", rgb: "245,158,11" },
          { id: "porosity", name: "Porosity", color: "#3b82f6", rgb: "59,130,246" },
          { id: "slag", name: "Slag", color: "#8b5cf6", rgb: "139,92,246" },
          { id: "undercut", name: "Undercut", color: "#ec4899", rgb: "236,72,153" }
        ];
      }
    } else {
      if (rtModelClass === 'binary') {
        return [
          { id: "defect", name: "Defect", color: "#ef4444", rgb: "239,68,68" }
        ];
      } else if (rtModelClass === '4cls') {
        return [
          { id: "crack", name: "Crack", color: "#ef4444", rgb: "239,68,68" },
          { id: "volumetric", name: "Volumetric", color: "#3b82f6", rgb: "59,130,246" },
          { id: "union", name: "Union", color: "#f59e0b", rgb: "245,158,11" },
          { id: "surface", name: "Surface", color: "#8b5cf6", rgb: "139,92,246" }
        ];
      } else {
        return [
          { id: "crack", name: "Crack", color: "#ef4444", rgb: "239,68,68" },
          { id: "porosity", name: "Porosity", color: "#3b82f6", rgb: "59,130,246" },
          { id: "lack_of_union", name: "Lack of Union", color: "#f59e0b", rgb: "245,158,11" },
          { id: "slag", name: "Slag inclusion", color: "#10b981", rgb: "16,185,129" },
          { id: "undercut", name: "Undercut", color: "#8b5cf6", rgb: "139,92,246" },
          { id: "inclusion", name: "Inclusion", color: "#ec4899", rgb: "236,72,153" },
          { id: "spatter", name: "Spatter", color: "#64748b", rgb: "100,116,139" }
        ];
      }
    }
  };

  // Map path to tab name for active styling
  const activeTab = location.pathname === '/' ? 'Dashboard' : 
                    location.pathname.startsWith('/scan') ? 'Scan' :
                    location.pathname.startsWith('/history') ? 'History' :
                    location.pathname.startsWith('/global-traffic') ? 'Global Traffic' :
                    location.pathname.startsWith('/analytics') ? 'Analytics' :
                    location.pathname.startsWith('/audit') ? 'Audit' :
                    location.pathname.startsWith('/users') ? 'Users' :
                    location.pathname.startsWith('/report') ? 'Report' : 'Dashboard';

  const setActiveTab = (tab) => {
    const path = tab === 'Dashboard' ? '/' : `/${tab.toLowerCase().replace(/ /g, '-')}`;
    navigate(path);
  };

  // History detail: derive selected item from URL path
  const pathParts = location.pathname.split('/');
  const historyIdFromUrl = pathParts[1] === 'history' ? pathParts[2] : null;
  const selectedHistoryItem = (historyIdFromUrl && Array.isArray(inspections)) 
    ? inspections.find(i => i && i.id && i.id.toString() === historyIdFromUrl) 
    : null;
  const handleLogout = () => {
    localStorage.removeItem('user_id');
    localStorage.removeItem('user_role');
    setUserId(null);
    setUserRole(null);
    setShowLogin(true);
    setActiveTab('Dashboard');
    setIsMobileMenuOpen(false);
  };

  // Dynamically calculate defect distribution
  const defectCounts = {};
  inspections.forEach(insp => {
    if (insp.detections) {
      insp.detections.forEach(det => {
        if (det.type === 'box') {
          const label = det.label.replace('_', ' ');
          defectCounts[label] = (defectCounts[label] || 0) + 1;
        }
      });
    }
  });
  
  let defectData = Object.keys(defectCounts).map(label => {
    const originalLabel = label.replace(' ', '_');
    return {
      name: label,
      value: defectCounts[label],
      color: getColorForLabel(originalLabel)?.hex || '#64748b'
    };
  });
  
  if (defectData.length === 0) {
    defectData = [
      { name: 'No Defects Found', value: 1, color: '#10b981' }
    ];
  }

  // Dynamically calculate accept/refuse rate
  const acceptedCount = inspections.filter(i => i.decision && i.decision.toLowerCase() === 'accepted').length;
  const refusedCount = inspections.filter(i => i.decision && i.decision.toLowerCase() === 'refused').length;
  const pendingCount = inspections.filter(i => !i.decision || (i.decision.toLowerCase() !== 'accepted' && i.decision.toLowerCase() !== 'refused')).length;
  const totalDecisions = acceptedCount + refusedCount + pendingCount;
  
  let rateData = [];
  if (totalDecisions === 0) {
    rateData = [{ name: 'No Data', value: 1, color: '#334155' }];
  } else {
    if (acceptedCount > 0) rateData.push({ name: 'Accepted', value: acceptedCount, color: '#10b981' });
    if (refusedCount > 0) rateData.push({ name: 'Refused', value: refusedCount, color: '#ef4444' });
    if (pendingCount > 0) rateData.push({ name: 'Pending', value: pendingCount, color: '#f59e0b' });
  }

  const bandwidthData = Array.from({length: 12}, (_, i) => ({
    time: `${i * 2}:00`,
    data: Math.floor(Math.random() * 50) + 10
  }));

  // Dynamically calculate daily inspections for the calendar
  const last7Days = Array.from({length: 7}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    return {
      dateObj: d,
      dayStr: d.toLocaleDateString('en-US', { weekday: 'short' }),
      count: 0
    };
  });

  inspections.forEach(insp => {
    if (insp.timestamp) {
      // Assuming timestamp is like "5/7/2026, 4:22:33 AM"
      const inspDate = new Date(insp.timestamp);
      inspDate.setHours(0, 0, 0, 0);
      
      const dayMatch = last7Days.find(d => d.dateObj.getTime() === inspDate.getTime());
      if (dayMatch) {
        dayMatch.count += 1;
      }
    }
  });

  const calendarData = last7Days.map(d => ({
    day: d.dayStr,
    inspections: d.count
  }));

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="w-full border-b border-white/5 bg-dark-900/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col lg:flex-row items-center justify-between gap-4 lg:gap-6">
          
          {/* Top Row for Mobile (Logo + Profile) */}
          <div className="flex items-center justify-between w-full lg:w-auto">
            {/* Constructed CSS Logo */}
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 bg-white shadow-lg shadow-black/20 flex items-center justify-center rounded-xl border border-white/10">
                <span className="text-slate-900 font-black text-2xl sm:text-4xl tracking-tighter">I</span>
                <span className="text-red-600 font-black text-2xl sm:text-4xl tracking-tighter">P</span>
              </div>
              <div className="flex flex-col justify-center mt-1 sm:mt-2">
                <div className="flex items-baseline gap-1.5 sm:gap-2 leading-none mb-0.5">
                  <span className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent text-xl sm:text-3xl font-black uppercase tracking-tight">
                    Inspection
                  </span>
                  <span className="bg-gradient-to-br from-red-500 to-red-700 bg-clip-text text-transparent text-xl sm:text-3xl font-black uppercase tracking-tight">
                    Power
                  </span>
                </div>
                <span className="text-[6px] sm:text-[8px] text-slate-400 font-semibold tracking-widest uppercase">
                  Contrôle non destructif et Inspection de soudage
                </span>
              </div>
            </div>

            {/* Mobile Profile & Menu Button (hidden on lg) */}
            <div className="lg:hidden flex items-center gap-4">
              <div className="relative cursor-pointer" onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}>
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${userId || 'Guest'}&backgroundColor=fca5a5`} alt="Profile" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-white/10 object-cover bg-slate-800"/>
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#0a0e17] rounded-full"></span>
                
                {isProfileMenuOpen && (
                  <div className="absolute top-full mt-2 right-0 w-48 bg-[#0a0e17] border border-white/10 rounded-xl shadow-2xl z-[300] overflow-hidden">
                    <div className="p-3 border-b border-white/10 bg-white/[0.02]">
                      <div className="text-sm font-bold text-white">{userId || 'Guest'}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{userRole || 'Inspector'}</div>
                    </div>
                    <div className="p-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                        className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 -mr-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 transition-colors border border-white/5"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
              </button>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex flex-1 items-center justify-center gap-8">
            <button onClick={() => setActiveTab('Dashboard')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Dashboard' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Dashboard</button>
            <button onClick={() => setActiveTab('Scan')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Scan' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Scan</button>
            <button onClick={() => setActiveTab('Analytics')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Analytics' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Analytics</button>
            <button onClick={() => setActiveTab('Global Traffic')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Global Traffic' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Models</button>
            <button onClick={() => setActiveTab('Users')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Users' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Users</button>
            <button onClick={() => setActiveTab('History')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'History' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>History</button>
            {(userRole === 'Lead Inspector' || userRole === 'admin') && (
              <button onClick={() => setActiveTab('Audit')} className={`text-sm font-medium transition-colors pb-1 border-b-2 ${activeTab === 'Audit' ? 'text-red-500 border-red-500' : 'text-slate-400 hover:text-white border-transparent'}`}>Audit Log</button>
            )}
          </nav>

          {/* Desktop Profile Area */}
          <div className="hidden lg:flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-medium text-emerald-400">Live Inference</span>
            </div>
            <div className="w-px h-6 bg-white/10"></div>
            <div className="relative cursor-pointer" onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}>
              <div className="flex items-center gap-3 group">
                <div className="flex-col items-end flex">
                  <span className="text-sm font-medium text-white group-hover:text-red-400 transition-colors">{userId || 'Guest'}</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider">{userRole || 'Inspector'}</span>
                </div>
                <div className="relative">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${userId || 'Guest'}&backgroundColor=fca5a5`} alt="Profile" className="w-10 h-10 rounded-full border-2 border-white/10 group-hover:border-red-400 transition-colors object-cover bg-slate-800"/>
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0a0e17] rounded-full"></span>
                </div>
              </div>

              {isProfileMenuOpen && (
                <div className="absolute top-full mt-4 right-0 w-56 bg-[#0a0e17] border border-white/10 rounded-xl shadow-2xl z-[300] overflow-hidden transform transition-all">
                  <div className="p-4 border-b border-white/10 bg-white/[0.02]">
                    <div className="text-sm font-bold text-white truncate">{userId || 'Guest'}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">{userRole || 'Inspector'}</div>
                  </div>
                  <div className="p-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                      className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center gap-3"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] lg:hidden"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 w-64 h-full bg-[#0a0e17] border-l border-white/10 z-[210] flex flex-col shadow-2xl lg:hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/[0.02]">
                <span className="text-sm font-black text-white uppercase tracking-widest">Navigation</span>
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
              <div className="flex flex-col gap-2 p-4">
                {['Dashboard', 'Scan', 'Analytics', 'Global Traffic', 'Users', 'History', ...(userRole === 'Lead Inspector' || userRole === 'admin' ? ['Audit'] : [])].map((tab) => (
                  <button 
                    key={tab}
                    onClick={() => { setActiveTab(tab); setIsMobileMenuOpen(false); }} 
                    className={`text-left px-4 py-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              
              <div className="mt-auto p-6 border-t border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]"></span>
                  <div>
                    <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">System Online</div>
                    <div className="text-[9px] text-slate-500 font-mono mt-1">v2.1.0-stable</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col">
        <Routes>
          <Route path="*" element={<>
            {activeTab === 'Dashboard' ? (
          <motion.div initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} className="flex-1 flex flex-col gap-6 w-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">
                  <span className="bg-gradient-to-r from-red-500 via-red-400 to-slate-300 bg-clip-text text-transparent">
                    NOC System Overview
                  </span>
                </h2>
                <p className="text-xs text-slate-500">Real-time infrastructure telemetry and AI model status.</p>
              </div>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest font-bold">System Online</span>
              </div>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="glass-card p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/10 rounded-bl-full blur-xl"></div>
                <h4 className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Total Inspections</h4>
                <div className="text-3xl font-light text-white font-mono">{inspections.length}</div>
              </div>
              <div className="glass-card p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full blur-xl"></div>
                <h4 className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Active Users</h4>
                <div className="text-3xl font-light text-emerald-400 font-mono">{users.filter(u => u.status === 'ONLINE').length}</div>
              </div>
              <div className="glass-card p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/10 rounded-bl-full blur-xl"></div>
                <h4 className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Avg Latency</h4>
                <div className="text-3xl font-light text-amber-400 font-mono">
                  {Math.round([...yoloHistory, ...qwenHistory].filter(l => l > 0).reduce((a,b)=>a+b,0) / ([...yoloHistory, ...qwenHistory].filter(l => l > 0).length || 1))} <span className="text-sm text-slate-500">ms</span>
                </div>
              </div>
              <div className="glass-card p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/10 rounded-bl-full blur-xl"></div>
                <h4 className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">Active AI Models</h4>
                <div className="text-3xl font-light text-cyan-400 font-mono">{globalStats.length}</div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-6">
              {/* Dual Telemetry Widget */}
              <div className="glass-card p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between mb-2 border-b border-white/5 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]"></span>
                    <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em]">Global Telemetry Grid</h4>
                  </div>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">VISUAL <span className="text-red-400 font-mono ml-1">{yoloLatency}ms</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">RADIO <span className="text-purple-400 font-mono ml-1">{radioLatency}ms</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
                        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">QWEN <span className="text-cyan-400 font-mono ml-1">{qwenLatency}ms</span></span>
                      </div>
                    </div>
                </div>
                
                <div className="h-32 flex items-end gap-1.5 w-full pt-4 border-b border-white/5 pb-2">
                  {yoloHistory.map((val, i) => {
                    const rVal = radioHistory[i];
                    const qVal = qwenHistory[i];
                    const maxVal = Math.max(val, rVal, qVal, 200);
                    
                    const hY = val === 0 ? 2 : Math.min(Math.max((val / maxVal) * 100, 5), 100);
                    const hR = rVal === 0 ? 2 : Math.min(Math.max((rVal / maxVal) * 100, 5), 100);
                    const hQ = qVal === 0 ? 2 : Math.min(Math.max((qVal / maxVal) * 100, 5), 100);

                    return (
                      <div key={i} className="flex-1 flex gap-0.5 h-full items-end group cursor-crosshair relative">
                        {/* YOLO Visual Bar */}
                        <div className={`flex-1 rounded-t-sm opacity-90 transition-all duration-300 shadow-[0_-2px_10px_rgba(239,68,68,0.2)] group-hover:opacity-100 group-hover:brightness-125 ${val === 0 ? 'bg-slate-800' : 'bg-red-500'}`} style={{height: `${hY}%`}}></div>
                        {/* YOLO Radio Bar */}
                        <div className={`flex-1 rounded-t-sm opacity-90 transition-all duration-300 shadow-[0_-2px_10px_rgba(168,85,247,0.2)] group-hover:opacity-100 group-hover:brightness-125 ${rVal === 0 ? 'bg-slate-800' : 'bg-purple-500'}`} style={{height: `${hR}%`}}></div>
                        {/* Qwen Bar */}
                        <div className={`flex-1 rounded-t-sm opacity-90 transition-all duration-300 shadow-[0_-2px_10px_rgba(6,182,212,0.2)] group-hover:opacity-100 group-hover:brightness-125 ${qVal === 0 ? 'bg-slate-800' : 'bg-cyan-500'}`} style={{height: `${hQ}%`}}></div>
                        
                        {(val > 0 || rVal > 0 || qVal > 0) && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black/80 backdrop-blur-md px-2 py-1.5 rounded text-[10px] font-mono opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] border border-white/10 flex flex-col gap-1">
                            {val > 0 && <span className="text-red-400">VISUAL: {val} ms</span>}
                            {rVal > 0 && <span className="text-purple-400">RADIO: {rVal} ms</span>}
                            {qVal > 0 && <span className="text-cyan-400">QWEN: {qVal} ms</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                <div className="flex justify-between text-[10px] text-slate-500 font-mono font-bold mt-2">
                  <span className="flex items-center gap-1"><svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Polling Interval: 5s</span>
                  <span className="flex items-center gap-1">Target Host: <span className="text-slate-400">{API_URL.replace('http://', '').replace('https://', '')}</span></span>
                </div>
              </div>
            </div>

            {/* New Widgets Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mt-6">
              {/* Defect Distribution Chart */}
              <div className="glass-card p-6 flex flex-col gap-4">
                 <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-2">Defect Distribution</h4>
                 <div className="flex-1 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={defectData}
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {defectData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff', fontSize: '12px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                 </div>
                 <div className="flex justify-center flex-wrap gap-4 mt-2">
                   {defectData.map((entry, idx) => (
                     <div key={idx} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                       <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                       {entry.name} ({entry.value})
                     </div>
                   ))}
                 </div>
              </div>

              {/* Accept vs Refuse Rate */}
              <div className="glass-card p-6 flex flex-col gap-4">
                 <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-2">Accept vs Refuse</h4>
                 <div className="flex-1 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={rateData}
                          innerRadius={50}
                          outerRadius={70}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {rateData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} itemStyle={{ color: '#fff', fontSize: '12px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                 </div>
                 <div className="flex justify-center flex-wrap gap-4 mt-2">
                   {rateData.map((entry, idx) => (
                     <div key={idx} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                       <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                       {entry.name} ({totalDecisions > 0 ? Math.round(entry.value / totalDecisions * 100) : 0}%)
                     </div>
                   ))}
                 </div>
              </div>

              {/* Daily Inspection Calendar (Bar Chart) */}
              <div className="glass-card p-6 flex flex-col gap-4">
                 <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em] mb-2">Daily Inspections</h4>
                 <div className="flex-1 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={calendarData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                        <XAxis dataKey="day" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: '#94a3b8', fontSize: '10px' }} itemStyle={{ color: '#06b6d4', fontSize: '12px' }} />
                        <Bar dataKey="inspections" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                 </div>
                 <div className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2">
                   7-Day Activity Calendar
                 </div>
              </div>

              {/* API Rate Limit / Bandwidth Chart */}
              <div className="glass-card p-6 flex flex-col gap-4">
                 <div className="flex justify-between items-center mb-2">
                   <h4 className="text-xs text-slate-300 uppercase font-black tracking-[0.2em]">API Bandwidth</h4>
                   <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">LIVE</span>
                 </div>
                 <div className="flex-1 min-h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={bandwidthData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorBw" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                        <RechartsTooltip contentStyle={{ backgroundColor: '#0a0e17', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} labelStyle={{ color: '#94a3b8', fontSize: '10px' }} itemStyle={{ color: '#06b6d4', fontSize: '12px' }} />
                        <Area type="monotone" dataKey="data" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorBw)" />
                      </AreaChart>
                    </ResponsiveContainer>
                 </div>
                 <div className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2">
                   Server Data Transfer
                 </div>
              </div>
            </div>
          </motion.div>
        ) : activeTab === 'Scan' ? (
          <>
            <motion.div initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} className="text-center mb-4">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight mb-1">
                <span className="bg-gradient-to-r from-red-500 via-red-400 to-slate-300 bg-clip-text text-transparent">
                  Inspection Power Analysis Hub
                </span>
              </h2>
              <p className="text-xs text-slate-500 max-w-xl mx-auto">
                Upload an image for real-time defect detection using advanced AI analysis.
                Identify critical defects and verify quality with industrial-grade accuracy.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Controls */}
              <div className="lg:col-span-3 flex flex-col gap-6">
                <div className="glass-card p-5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">1. Input Source</h3>
                  <label className="block border border-dashed border-white/10 rounded-xl p-6 text-center cursor-pointer hover:bg-white/5 hover:border-red-500/50 transition-all group">
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                      <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                    </div>
                    <div className="text-sm font-medium text-white mb-1">Click to upload image</div>
                    <div className="text-xs text-slate-500 break-all">{imageFile ? imageFile.name : "PNG, JPG up to 10MB"}</div>
                    <input type="file" onChange={handleImageSelect} accept="image/*" className="hidden" />
                  </label>
                </div>

                <div className="glass-card p-5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Weld Metadata Details</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Weld ID</label>
                      <input 
                        type="text" 
                        placeholder="e.g. W-2026-042" 
                        value={weldForm.weld_id}
                        onChange={(e) => setWeldForm(f => ({ ...f, weld_id: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Project Name</label>
                        <input 
                          type="text" 
                          placeholder="Pipeline A" 
                          value={weldForm.project_name}
                          onChange={(e) => setWeldForm(f => ({ ...f, project_name: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Client</label>
                        <input 
                          type="text" 
                          placeholder="Sonatrach" 
                          value={weldForm.client_name}
                          onChange={(e) => setWeldForm(f => ({ ...f, client_name: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Thickness (mm)</label>
                        <input 
                          type="number" 
                          step="0.1"
                          placeholder="e.g. 12.5" 
                          value={weldForm.thickness_mm}
                          onChange={(e) => setWeldForm(f => ({ ...f, thickness_mm: e.target.value }))}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-red-500 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Standard</label>
                        <select 
                          value={weldForm.standard}
                          onChange={(e) => setWeldForm(f => ({ ...f, standard: e.target.value }))}
                          className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-red-500 transition-colors"
                        >
                          {['EN 1435', 'ASME V', 'ISO 17636', 'API 1104', 'AWS D1.1'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Material</label>
                      <select 
                        value={weldForm.material}
                        onChange={(e) => setWeldForm(f => ({ ...f, material: e.target.value }))}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-red-500 transition-colors"
                      >
                        {['Carbon Steel', 'Stainless Steel', 'Alloy Steel', 'Duplex Steel', 'Aluminium'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="glass-card p-5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">2. Inspection Type</h3>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'Auto-Detect', label: 'Auto' },
                      { id: 'Visual (Photo)', label: 'Visual' },
                      { id: 'Radiographic (X-Ray)', label: 'Radio' }
                    ].map(m => {
                      const isActive = analysisModel === m.id;
                      return (
                        <button 
                          key={m.id}
                          onClick={() => setAnalysisModel(m.id)}
                          className={`py-2 px-1 rounded-lg border text-center transition-all duration-200 text-[9px] font-black uppercase tracking-wider ${isActive ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Sub-model class selection */}
                  {analysisModel === 'Radiographic (X-Ray)' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">RT Model Class</h4>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { id: 'binary', label: 'Binary' },
                          { id: '4cls', label: '4-Class' },
                          { id: '7cls', label: '7-Class' }
                        ].map(mc => {
                          const isSel = rtModelClass === mc.id;
                          return (
                            <button
                              key={mc.id}
                              onClick={() => setRtModelClass(mc.id)}
                              className={`py-2 px-1 rounded-lg border text-center transition-all duration-200 text-[9px] font-bold uppercase tracking-wider ${isSel ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                            >
                              {mc.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {analysisModel === 'Visual (Photo)' && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">VT Model Class</h4>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { id: 'binary', label: 'Binary' },
                          { id: '4cls', label: '6-Class' }
                        ].map(mc => {
                          const isSel = vtModelClass === mc.id;
                          return (
                            <button
                              key={mc.id}
                              onClick={() => setVtModelClass(mc.id)}
                              className={`py-2 px-1 rounded-lg border text-center transition-all duration-200 text-[9px] font-bold uppercase tracking-wider ${isSel ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-white border-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                            >
                              {mc.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {analysisModel === 'Auto-Detect' && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500" />
                          If Radiographic Detected
                        </h4>
                        <div className="grid grid-cols-3 gap-1.5">
                          {[
                            { id: 'binary', label: 'Binary' },
                            { id: '4cls', label: '4-Class' },
                            { id: '7cls', label: '7-Class' }
                          ].map(mc => {
                            const isSel = rtModelClass === mc.id;
                            return (
                              <button
                                key={`rt-${mc.id}`}
                                onClick={() => setRtModelClass(mc.id)}
                                className={`py-2 px-1 rounded-lg border text-center transition-all duration-200 text-[9px] font-bold uppercase tracking-wider ${isSel ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                              >
                                {mc.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-500" />
                          If Visual Detected
                        </h4>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { id: 'binary', label: 'Binary' },
                            { id: '4cls', label: '6-Class' }
                          ].map(mc => {
                            const isSel = vtModelClass === mc.id;
                            return (
                              <button
                                key={`vt-${mc.id}`}
                                onClick={() => setVtModelClass(mc.id)}
                                className={`py-2 px-1 rounded-lg border text-center transition-all duration-200 text-[9px] font-bold uppercase tracking-wider ${isSel ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-800'}`}
                              >
                                {mc.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="glass-card p-5">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">3. Neural Analysis</h3>
                  <button onClick={runAnalysis} disabled={!imageFile || isProcessing} className="btn-gradient w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <span>{isProcessing ? "Analyzing..." : (detections.length > 0 ? "Analysis Complete" : "Run Neural Analysis")}</span>
                  </button>
                </div>

                <div className={`glass-card p-5 transition-opacity ${detections.length === 0 ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Confidence Filter</h3>
                    <span className="text-[10px] font-mono font-black text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20">{(confThreshold * 100).toFixed(0)}%</span>
                  </div>
                  <div className="space-y-2">
                    <input 
                      type="range" 
                      min="0.10" 
                      max="0.90" 
                      step="0.05" 
                      value={confThreshold} 
                      onChange={(e) => setConfThreshold(parseFloat(e.target.value))} 
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                    <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                      <span>Sensitive (10%)</span>
                      <span>Strict (90%)</span>
                    </div>
                  </div>
                </div>

                <div className={`glass-card p-5 transition-opacity ${detections.length === 0 ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">4. Display & Report</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/5 pb-4">
                      <span className="text-xs font-medium text-slate-300 uppercase tracking-widest">Show Masks</span>
                      <label className="switch">
                        <input type="checkbox" checked={showAnnotations} onChange={(e) => setShowAnnotations(e.target.checked)} />
                        <span className="slider"></span>
                      </label>
                    </div>
                    <button 
                      onClick={() => setActiveTab('Report')}
                      className="w-full py-3 bg-emerald-500 text-slate-900 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                      Preview Full Version UI
                    </button>
                  </div>
                </div>
              </div>

              {/* Viewer */}
          <div className="lg:col-span-6 flex flex-col">
            <div className="glass-card p-2 flex items-center justify-center relative" style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
              
              {isProcessing && (
                <div className="absolute inset-0 bg-dark-900/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-xl">
                  <div className="loader-spinner mb-4"></div>
                  <div className="text-sm font-medium text-red-400 animate-pulse">Running YOLO Inference...</div>
                </div>
              )}

              {!imagePreview ? (
                <div className="text-center text-slate-500 flex flex-col items-center">
                  <svg className="w-16 h-16 opacity-20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <p className="text-sm font-medium">No image selected</p>
                  <p className="text-xs mt-1">Upload an image to view it here</p>
                </div>
              ) : (
                <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-xl bg-black">
                  <img ref={imgRef} src={imagePreview} onLoad={handleImageLoad} className="absolute inset-0 w-full h-full object-contain" alt="Inspection" />
                  
                  {showAnnotations && viewBox && (
                    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
                      {/* Render Masks */}
                      {filteredMasks.map((mask, idx) => {
                        if (!mask.points || mask.points.length < 3) return null;
                        const colorObj = getColorForLabel(mask.label);
                        let p0 = mask.points[0];
                        let p1 = mask.points[1];
                        let d = `M ${(p0[0]+p1[0])/2},${(p0[1]+p1[1])/2}`;
                        for (let i = 1; i <= mask.points.length; i++) {
                          let current = mask.points[i % mask.points.length];
                          let next = mask.points[(i + 1) % mask.points.length];
                          let midX = (current[0] + next[0]) / 2;
                          let midY = (current[1] + next[1]) / 2;
                          d += ` Q ${current[0]},${current[1]} ${midX},${midY}`;
                        }
                        return (
                          <path
                            key={`mask-${idx}`}
                            d={d}
                            className="mask-polygon"
                            style={{
                              '--base-color': `rgba(${colorObj.rgb}, 0.35)`,
                              '--hover-color': `rgba(${colorObj.rgb}, 0.7)`,
                              filter: 'blur(1px)'
                            }}
                          />
                        );
                      })}
                      {/* Render Boxes (Labels) */}
                      {filteredBoxes.map((box, idx) => {
                        if (!box.xyxy) return null;
                        const [x1, y1, x2, y2] = box.xyxy;
                        
                        const w = x2 - x1;
                        const h = y2 - y1;
                        const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
                        // Automatic fixed field of view scaling
                        const mmPerPx = 150 / imageWidthPx;
                        const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);

                        const colorObj = getColorForLabel(box.label);
                        const labelText = `${box.label.replace('_', ' ')} ${sizeMm}mm (${(box.confidence * 100).toFixed(0)}%)`;
                        const textWidth = Math.max(labelText.length * 7.5 + 14, 60);
                        const textHeight = 22;
                        const yPos = Math.max(0, y1 - textHeight - 2);

                        return (
                          <g key={`box-${idx}`} style={{ cursor: 'pointer' }}>
                            {/* Bounding Box Defect Outline — hidden for Visual inspections (mask-only) */}
                            {!isVisualInspection && (
                              <rect
                                x={x1}
                                y={y1}
                                width={w}
                                height={h}
                                fill={`rgba(${colorObj.rgb}, 0.2)`}
                                stroke={colorObj.hex}
                                strokeWidth="2"
                                style={{ 
                                  transition: 'all 0.3s ease',
                                  filter: `drop-shadow(0 0 3px rgba(${colorObj.rgb}, 0.5))`
                                }}
                              />
                            )}
                            {/* Floating Label Badge */}
                            <rect
                              x={x1} y={yPos} width={textWidth} height={textHeight} rx="4"
                              fill={`rgba(${colorObj.rgb}, 0.95)`}
                              stroke={colorObj.hex}
                              strokeWidth="1"
                            />
                            <text
                              x={x1 + 6} y={yPos + 16}
                              className="label-text capitalize font-mono font-bold fill-white"
                              style={{ fontSize: '13px' }}
                            >
                              {labelText}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Results Sidebar */}
          <div className="lg:col-span-3 flex flex-col">
            <div className="glass-card p-5 flex-1 flex flex-col max-h-[800px]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Detection Results</h3>
                <span className="bg-white/10 text-white text-xs py-1 px-2 rounded-md font-mono">{filteredBoxes.length}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                {detections.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm mt-8">
                    {imagePreview ? "Ready to analyze." : "Analysis results will appear here."}
                  </div>
                ) : filteredBoxes.length === 0 ? (
                  <div className="text-center text-emerald-400 text-sm mt-8 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
                    No defects found. Quality accepted.
                  </div>
                ) : (
                  filteredBoxes.map((det, idx) => {
                    const confPercent = (det.confidence * 100).toFixed(1);
                    const colorObj = getColorForLabel(det.label);
                    
                    const [x1, y1, x2, y2] = det.xyxy;
                    const w = x2 - x1;
                    const h = y2 - y1;
                    const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
                    // Automatic fixed field of view scaling
                    const mmPerPx = 150 / imageWidthPx;
                    const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);

                    return (
                      <div 
                        key={idx} 
                        onClick={() => focusOnDefect(det)}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-red-500/10 hover:border-red-500/30 transition-all cursor-pointer group active:scale-[0.98]"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorObj.hex, boxShadow: `0 0 8px ${colorObj.hex}80` }}></div>
                            <span className="text-sm font-medium text-white group-hover:text-red-400 transition-colors capitalize">{det.label.replace('_', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 bg-black/40 border border-white/5 px-1.5 py-0.5 rounded tracking-widest">{sizeMm}mm</span>
                            <span className="text-sm font-bold font-mono" style={{ color: colorObj.hex }}>{confPercent}%</span>
                          </div>
                        </div>
                        <div className="w-full bg-black/40 rounded-full h-1.5 mt-2 overflow-hidden">
                          <div className="h-1.5 rounded-full" style={{ width: `${confPercent}%`, backgroundColor: colorObj.hex }}></div>
                        </div>
                        <div className="flex justify-end mt-2">
                          <span className="text-[8px] text-red-500 font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Analyze with AI →</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {detections.length > 0 && (
                <button
                  type="button"
                  onClick={openRetrainStudio}
                  className="w-full mt-4 py-3 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-red-500/5 flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  Correct Defects
                </button>
              )}

              {/* Inspector Decision Workflow */}
              {currentInspectionId && (
                <div className="mt-6 pt-6 border-t border-white/10">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 text-center flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Inspection Rapport Preview
                  </h3>
                  




                  {!currentInspectionDecision ? (
                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        onClick={() => handleDecision('Refused')}
                        className="flex flex-col items-center justify-center gap-1 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl font-bold hover:bg-red-500/20 transition-all group"
                      >
                        <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        <span>REFUSE</span>
                      </button>
                      <button 
                        onClick={() => handleDecision('Accepted')}
                        className="flex flex-col items-center justify-center gap-1 py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl font-bold hover:bg-emerald-500/20 transition-all group"
                      >
                        <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        <span>ACCEPT</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className={`py-4 text-center rounded-xl border ${currentInspectionDecision === 'Accepted' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-red-500/20 border-red-500/50 text-red-400'}`}>
                        <div className="text-xs uppercase tracking-widest mb-1 opacity-60">Final Decision</div>
                        <div className="text-lg font-black tracking-tighter">{currentInspectionDecision.toUpperCase()}</div>
                      </div>

                      <button 
                        onClick={() => generatePDFReport(currentInspectionDecision, currentInspectionId, filteredDetections, reportNotes)}
                        className="w-full py-4 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white rounded-xl font-black shadow-lg shadow-red-500/20 flex items-center justify-center gap-3 transition-all transform active:scale-95 uppercase tracking-widest text-xs"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                        Download Final PDF Report
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
      ) : activeTab === 'History' ? (
          <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} className="flex-1 w-full bg-black/20 backdrop-blur-xl border border-white/10 rounded-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6 border-b border-white/5 pb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Inspection History
              </h2>
              <span className="text-xs text-slate-400 font-mono bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">{inspections.length} Records Found</span>
            </div>

            {loadingHistory ? (
              <div className="flex-1 flex flex-col items-center justify-center py-40">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-red-500/10"></div>
                  <div className="absolute inset-0 rounded-full border-4 border-t-red-500 animate-spin"></div>
                </div>
                <p className="mt-6 text-slate-500 font-bold uppercase tracking-widest text-[10px] animate-pulse">Synchronizing Records...</p>
              </div>
            ) : selectedHistoryItem ? (
              /* Detail View */
              <div className="flex-1 flex flex-col">
                <button 
                  onClick={() => navigate('/history')}
                  className="mb-6 flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                  BACK TO HISTORY
                </button>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass-card p-6">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">I. Neural Image Capture</h3>
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-white/5 relative group">
                      <img 
                        ref={imgRef}
                        src={selectedHistoryItem.image || selectedHistoryItem.image_preview} 
                        onLoad={handleImageLoad}
                        className="w-full h-full object-contain" 
                        alt="Scan" 
                      />
                      <svg 
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox={viewBox}
                        preserveAspectRatio="xMidYMid meet"
                      >
                        {/* Render Masks */}
                        {(selectedHistoryItem.detections || []).filter(d => d.type === 'mask').map((mask, idx) => {
                          if (!mask.points || mask.points.length < 3) return null;
                          const colorObj = getColorForLabel(mask.label);
                          let p0 = mask.points[0];
                          let p1 = mask.points[1];
                          let d = `M ${(p0[0]+p1[0])/2},${(p0[1]+p1[1])/2}`;
                          for (let i = 1; i <= mask.points.length; i++) {
                            let current = mask.points[i % mask.points.length];
                            let next = mask.points[(i + 1) % mask.points.length];
                            let midX = (current[0] + next[0]) / 2;
                            let midY = (current[1] + next[1]) / 2;
                            d += ` Q ${current[0]},${current[1]} ${midX},${midY}`;
                          }
                          return (
                            <g key={`hist-mask-${idx}`}>
                              <path
                                d={d}
                                fill={`rgba(${colorObj.rgb}, 0.4)`}
                              />
                              <text 
                                x={mask.points[0][0]} 
                                y={mask.points[0][1] - 5} 
                                fill="white" fontSize="14" fontWeight="bold" className="uppercase font-mono"
                              >
                                #{idx + 1} {mask.label.replace('_', ' ')}
                              </text>
                            </g>
                          );
                        })}
                        {/* Render Boxes */}
                        {(selectedHistoryItem.detections || []).filter(d => d.type === 'box').map((box, idx) => {
                          if (!box.xyxy) return null;
                          const [x1, y1, x2, y2] = box.xyxy;
                          const w = x2 - x1;
                          const h = y2 - y1;
                          const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
                          const mmPerPx = 150 / imageWidthPx;
                          const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);
                          const colorObj = getColorForLabel(box.label);
                          const labelText = `${box.label.replace('_', ' ')} ${sizeMm}mm (${(box.confidence * 100).toFixed(0)}%)`;
                          const textWidth = Math.max(labelText.length * 6 + 10, 50);
                          const textHeight = 16;
                          const yPos = Math.max(0, y1 - textHeight);
                          return (
                            <g key={`hist-box-${idx}`}>
                              <rect
                                x={x1} y={y1} width={w} height={h}
                                fill={`rgba(${colorObj.rgb}, 0.2)`}
                                stroke={colorObj.hex}
                                strokeWidth="2"
                                style={{ filter: `drop-shadow(0 0 3px rgba(${colorObj.rgb}, 0.5))` }}
                              />
                              <rect
                                x={x1} y={yPos} width={textWidth} height={textHeight} rx="3"
                                fill={`rgba(${colorObj.rgb}, 0.95)`}
                                stroke={colorObj.hex}
                                strokeWidth="1"
                              />
                              <text
                                x={x1 + 5} y={yPos + 12}
                                className="label-text capitalize font-mono font-bold fill-white text-[10px]"
                              >
                                {labelText}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    <div className="glass-card p-6 flex-1">
                      <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">II. AI Technical Summary</h3>
                      <div className="space-y-3">
                        {(selectedHistoryItem.detections || []).map((det, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                              <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">#{i+1}</span>
                              <span className="text-sm font-bold text-slate-300 capitalize">{det.label.replace('_', ' ')}</span>
                            </div>
                            <span className="text-xs font-mono text-slate-500">{(det.confidence*100).toFixed(1)}% CONF</span>
                          </div>
                        ))}
                        {(selectedHistoryItem.detections || []).length === 0 && (
                          <div className="py-10 text-center text-slate-500 text-xs italic">No anomalies detected.</div>
                        )}
                      </div>
                    </div>

                    <div className="glass-card p-6">
                      <div className="flex flex-col gap-4">
                        {!selectedHistoryItem.decision ? (
                          <div className="grid grid-cols-2 gap-4">
                            <button 
                              onClick={async () => {
                                const decision = 'Refused';
                                try {
                                  await fetch(`${API_URL}/api/inspections/${selectedHistoryItem.id}`, {
                                    method: "PATCH",
                                    headers: { 
                                      "Content-Type": "application/json",
                                      "x-user-id": userId || "Anonymous",
                                      "x-user-role": userRole || "Inspector"
                                    },
                                    body: JSON.stringify({ decision })
                                  });
                                  setInspections(prev => prev.map(insp => insp.id === selectedHistoryItem.id ? { ...insp, decision } : insp));
                                } catch (e) { console.error(e); }
                              }}
                              className="flex flex-col items-center justify-center gap-1 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl font-bold hover:bg-red-500/20 transition-all group"
                            >
                              <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                              <span>REFUSE</span>
                            </button>
                            <button 
                              onClick={async () => {
                                const decision = 'Accepted';
                                try {
                                  await fetch(`${API_URL}/api/inspections/${selectedHistoryItem.id}`, {
                                    method: "PATCH",
                                    headers: { 
                                      "Content-Type": "application/json",
                                      "x-user-id": userId || "Anonymous",
                                      "x-user-role": userRole || "Inspector"
                                    },
                                    body: JSON.stringify({ decision })
                                  });
                                  setInspections(prev => prev.map(insp => insp.id === selectedHistoryItem.id ? { ...insp, decision } : insp));
                                } catch (e) { console.error(e); }
                              }}
                              className="flex flex-col items-center justify-center gap-1 py-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl font-bold hover:bg-emerald-500/20 transition-all group"
                            >
                              <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                              <span>ACCEPT</span>
                            </button>
                          </div>
                        ) : (
                          <div className={`py-4 text-center rounded-xl border font-black text-xs tracking-widest ${selectedHistoryItem.decision === 'Accepted' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-red-500/20 border-red-500/50 text-red-400'}`}>
                            {selectedHistoryItem.decision.toUpperCase()}
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            setImagePreview(selectedHistoryItem.image || selectedHistoryItem.image_preview);
                            setDetections(selectedHistoryItem.detections || []);
                            setCurrentModelUsed(selectedHistoryItem.model_used || '');
                            setCurrentInspectionId(selectedHistoryItem.id);
                            setCurrentInspectionDecision(selectedHistoryItem.decision);
                            setActiveTab('Report');
                          }}
                          className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-red-900/40 transition-all flex items-center justify-center gap-3"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                          Edit Technical Report
                        </button>
                        <button 
                          onClick={async () => {
                            if (!window.confirm("Are you sure you want to delete this inspection record?")) return;
                            try {
                              const resp = await fetch(`${API_URL}/api/inspections/${selectedHistoryItem.id}`, { 
                                method: 'DELETE',
                                headers: {
                                  "x-user-id": userId || "Anonymous",
                                  "x-user-role": userRole || "Inspector"
                                }
                              });
                              if (resp.ok) {
                                setInspections(prev => prev.filter(insp => insp.id !== selectedHistoryItem.id));
                                navigate('/history');
                              } else {
                                const err = await resp.json();
                                alert("Delete failed: " + (err.detail || "Unauthorized"));
                              }
                            } catch (e) {
                              console.error(e);
                            }
                          }}
                          className="w-full py-4 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-transparent hover:border-red-500/30 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          Delete Inspection
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : inspections.length === 0 ? (
              <div className="text-center text-slate-500 py-20 flex flex-col items-center">
                <svg className="w-12 h-12 mb-3 text-slate-600/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span>No inspections recorded in the database yet.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {inspections.map((insp, i) => {
                  const defectCount = (insp.detections || []).filter(d => d.type === 'box').length;
                  return (
                  <div key={i} className="glass-card p-4 group hover:border-red-500/50 transition-all cursor-pointer relative overflow-hidden" onClick={() => {
                    navigate('/history/' + insp.id);
                  }}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10 pointer-events-none"></div>
                    <div className="aspect-video w-full rounded-lg overflow-hidden bg-black/80 mb-4 border border-white/5 relative z-0">
                      {(insp.image || insp.image_preview) ? (
                        <img src={insp.image || insp.image_preview} alt="Scan" className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-700">No Image</div>
                      )}
                      <div className="absolute top-2 right-2 bg-black/80 backdrop-blur-md px-2 py-1 rounded border border-white/10 flex items-center gap-1.5 z-20">
                        <span className={`w-1.5 h-1.5 rounded-full ${defectCount > 0 ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                        <span className="text-[9px] font-bold text-white uppercase tracking-wider">{defectCount > 0 ? `${defectCount} Defects` : 'All Clear'}</span>
                      </div>
                    </div>
                    <div className="relative z-20 flex justify-between items-end">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center overflow-hidden border border-white/10">
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${insp.username || 'Guest'}&backgroundColor=transparent`} className="w-full h-full object-cover" alt="user" />
                          </div>
                          <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">{insp.username || 'Unknown'}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1">ID #{Math.floor(insp.id || Date.parse(insp.timestamp || new Date().toISOString()) || 0).toString().slice(-6)}</div>
                        <div className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">
                          {String(insp.timestamp || '').split(',')[0]}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="text-xs font-mono text-slate-400 bg-white/5 px-2 py-1 rounded">
                          {String(insp.timestamp || '').split(',')[1]?.trim() || insp.timestamp}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : activeTab === 'Global Traffic' ? (
          <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} className="flex-1 w-full">
            <GlobalTraffic 
              stats={globalStats} 
              onSelect={(model) => {
                setSelectedTraffic(model);
                setIsTrafficModalOpen(true);
              }} 
            />
          </motion.div>
        ) : activeTab === 'Users' ? (
          <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} className="flex-1 w-full">
            <UsersView users={users} />
          </motion.div>
        ) : activeTab === 'Analytics' ? (
          <AnalyticsView API_URL={API_URL} inspections={inspections} />
        ) : activeTab === 'Audit' ? (
          <AuditLogView API_URL={API_URL} />
        ) : null}
          </>} />
        </Routes>
      </main>

      {/* Floating AI Agent Trigger Button */}
      <AnimatePresence>
        {!showChat && (
          <motion.button 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowChat(true)}
            className="fixed bottom-8 right-8 z-[90] bg-gradient-to-br from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white shadow-[0_10px_40px_rgba(220,38,38,0.4)] border border-red-400/30 flex items-center gap-3 px-6 py-4 rounded-full transition-colors group cursor-pointer"
          >
            <div className="relative">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-red-700 animate-pulse"></span>
            </div>
            <span className="font-bold tracking-wide">Chat with AI</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* AI Chat Bot Panel Overlay */}
      <AnimatePresence>
        {showChat && (
          <motion.div 
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 w-full sm:w-[480px] h-full z-[100] bg-[#09090b]/98 backdrop-blur-3xl border-l border-white/10 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg shadow-red-500/20">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-wide">{showHistoryList ? "Chat History" : "Expert Inspection AI"}</h3>
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1.5 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Online Analysis</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowHistoryList(!showHistoryList)} 
                  className={`p-2 rounded-lg transition-all border ${showHistoryList ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-white/5 border-white/5 text-slate-300 hover:text-white'}`}
                  title="View History"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
                <button onClick={startNewChat} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-all border border-white/5 group" title="New Chat">
                  <svg className="w-4 h-4 group-hover:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                </button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-2 rounded-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col min-h-0">
              {showHistoryList ? (
                /* History List View */
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {chats.map(chat => (
                    <div 
                      key={chat.id} 
                      onClick={() => {
                        setCurrentChatId(chat.id);
                        setShowHistoryList(false);
                      }}
                      className={`group flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${currentChatId === chat.id ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${currentChatId === chat.id ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-3.5 h-3.5 rounded-full overflow-hidden bg-slate-800">
                              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.username || 'Guest'}&backgroundColor=transparent`} alt="user" />
                            </div>
                            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">{chat.username || 'Unknown'}</span>
                          </div>
                          <div className="text-sm font-bold text-white group-hover:text-red-400 transition-colors">{chat.title}</div>
                          <div className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-wider">{chat.messages.length} messages</div>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => deleteChat(chat.id, e)}
                        className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Delete Session"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                /* Active Chat View */
                <>
                  <div 
                    ref={chatContainerRef}
                    onScroll={handleChatScroll}
                    className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-gradient-to-b from-transparent to-black/20"
                  >
                    {currentChat.messages.length === 0 && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm p-4 text-sm text-slate-300 leading-relaxed shadow-lg">
                          Hello! I am your Industrial Inspection Assistant. System is ready—awaiting scan data to provide analysis.
                        </div>
                      </div>
                    )}

                    {currentChat.messages.map((msg, idx) => (
                      <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-800' : 'bg-red-600/20 border border-red-500/30'}`}>
                          {msg.role === 'user' 
                            ? <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Jane&backgroundColor=fca5a5" alt="User" className="rounded-full" />
                            : <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                          }
                        </div>
                        <div className={`p-4 text-[13px] rounded-2xl shadow-lg leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-gradient-to-br from-red-600 to-red-800 text-white rounded-tr-none' : 'bg-white/5 border border-white/10 text-slate-300 rounded-tl-none'}`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {typingChatId === currentChat.id && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-red-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-none p-4 flex items-center gap-1.5 h-10 w-16 justify-center">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input Area */}
                  <div className="p-5 border-t border-white/10 bg-black/40 backdrop-blur-xl">
                    <div className="relative group">
                      <input 
                        type="text" 
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                        disabled={!!typingChatId}
                        placeholder="Type a message..." 
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3.5 pl-4 pr-12 text-sm text-white focus:outline-none focus:border-red-500 transition-all placeholder:text-slate-600 disabled:opacity-50 shadow-inner"
                      />
                      <button 
                        onClick={() => {
                          if (typingChatId) {
                            stopTypingRef.current = true;
                          } else {
                            sendMessage();
                          }
                        }}
                        disabled={!typingChatId && !chatInput.trim()}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg transition-all shadow-lg ${typingChatId ? 'bg-red-500/20 border border-red-500/50 hover:bg-red-500 hover:text-white text-red-500 shadow-red-900/10' : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20'}`}
                      >
                        {typingChatId ? (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect width="12" height="12" x="6" y="6"></rect></svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="w-full border-t border-white/5 bg-dark-900/60 backdrop-blur-lg mt-auto">
        <div className="max-w-[1600px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 bg-white flex items-center justify-center rounded-lg border border-white/10">
              <span className="text-slate-900 font-black text-xl tracking-tighter">I</span>
              <span className="text-red-600 font-black text-xl tracking-tighter">P</span>
            </div>
            <div className="flex flex-col justify-center mt-1">
              <div className="flex items-baseline gap-1.5 leading-none mb-0">
                <span className="bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent text-lg font-black uppercase tracking-tight">Inspection</span>
                <span className="bg-gradient-to-br from-red-500 to-red-700 bg-clip-text text-transparent text-lg font-black uppercase tracking-tight">Power</span>
              </div>
              <span className="text-[7px] text-slate-500 font-semibold tracking-widest uppercase">
                Contrôle non destructif et Inspection de soudage
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-600 font-mono">Powered by YOLOv8</span>
            <span className="text-slate-700">•</span>
            <span className="text-[10px] text-slate-600 font-mono">React + Vite</span>
          </div>
        </div>
      </footer>

      {/* Full Report Preview Tab Logic (Handled in main switch) */}
      <AnimatePresence>
        {activeTab === 'Report' && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="fixed inset-0 z-[100] bg-slate-100 overflow-y-auto flex flex-col"
          >
            {/* Top Toolbar */}
            <div className="sticky top-0 z-[110] bg-slate-900 text-white px-8 py-4 flex justify-between items-center shadow-2xl">
              <div className="flex items-center gap-6">
                <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                  Exit Editor
                </button>
                <div className="h-6 w-px bg-white/10"></div>
                <div>
                  <h2 className="text-xs font-black uppercase tracking-widest text-red-500">Document Studio</h2>
                  <p className="text-[10px] text-slate-400 font-mono">Editing: Inspection_Report_{currentInspectionId}.pdf</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className={`px-3 py-1 rounded-full text-[10px] font-black border ${currentInspectionDecision === 'Accepted' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'}`}>
                  {currentInspectionDecision?.toUpperCase()}
                </div>
                <button 
                  onClick={() => generatePDFReport(currentInspectionDecision, currentInspectionId, filteredDetections, reportNotes)}
                  className="bg-red-600 hover:bg-red-500 text-white px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest shadow-lg shadow-red-900/40 transition-all flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 10-4 0v4a2 2 0 002 2zm-7 0h2a2 2 0 002-2v-4a2 2 0 10-4 0v4a2 2 0 002 2zM9 9h6M9 13h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  Generate PDF
                </button>
              </div>
            </div>

            {/* Document Workspace */}
            <div className="flex-1 p-4 sm:p-20 flex justify-center bg-slate-200/50">
              <div className="bg-white w-full max-w-[210mm] min-h-[297mm] shadow-[0_30px_60px_rgba(0,0,0,0.15)] rounded-sm flex flex-col my-4 sm:my-10 border border-slate-300">
                {/* Visual Header */}
                <div className="bg-slate-900 text-white p-12 flex justify-between items-start">
                  <div>
                    <h1 className="text-3xl font-black uppercase tracking-tighter mb-2">Quality Inspection Rapport</h1>
                    <div className="flex items-center gap-3">
                      <span className="text-red-500 font-bold text-[10px] tracking-[0.3em] uppercase">Industrial AI Audit</span>
                      <span className="h-3 w-px bg-white/20"></span>
                      <span className="text-slate-400 text-[10px] tracking-widest uppercase font-mono">Confidential Document</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase font-black mb-1">Rapport Reference</div>
                    <div className="text-sm font-mono font-bold text-white"># {String(currentInspectionId || '').slice(-8).toUpperCase()}</div>
                  </div>
                </div>

                <div className="p-16 text-slate-800 flex-1 space-y-12">
                  {/* Meta Grid & Joint Specifications */}
                  <div className="grid grid-cols-2 gap-12 pb-12 border-b border-slate-100">
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Inspection Metadata</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Primary Inspector</div>
                          <div className="text-xs font-bold text-slate-900">{userId || 'Anonymous User'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Analysis Date</div>
                          <div className="text-xs font-bold text-slate-900">{new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Weld ID Reference</div>
                          <div className="text-xs font-mono font-bold text-red-600">{weldForm.weld_id || `W-${String(currentInspectionId || '').slice(-6)}`}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Final Verdict</div>
                          <div className={`text-xs font-black uppercase ${currentInspectionDecision === 'Accepted' ? 'text-emerald-600' : 'text-red-600'}`}>{currentInspectionDecision?.toUpperCase() || 'PENDING'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-l border-slate-100 pl-12">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Joint Specifications</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Project Name</div>
                          <div className="text-xs font-bold text-slate-900">{weldForm.project_name || 'Sonatrach Pipeline A'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Client Name</div>
                          <div className="text-xs font-bold text-slate-900">{weldForm.client_name || 'Sonatrach'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Weld Thickness</div>
                          <div className="text-xs font-bold text-slate-900">{weldForm.thickness_mm ? `${weldForm.thickness_mm} mm` : '12.5 mm'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-black tracking-widest mb-0.5">Standard & Mat.</div>
                          <div className="text-xs font-bold text-slate-900">{weldForm.standard || 'EN 1435'} ({weldForm.material || 'Carbon Steel'})</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Scan Capture */}
                  <div className="space-y-6">
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em] border-l-[6px] border-red-600 pl-4">I. Neural Image Capture</h3>
                    <div className="w-full aspect-[16/9] rounded-lg overflow-hidden border-2 border-slate-100 bg-black flex items-center justify-center shadow-lg relative group">
                      {imagePreview ? (
                        <>
                          <img 
                            ref={imgRef}
                            src={imagePreview} 
                            onLoad={handleImageLoad}
                            className="max-w-full max-h-full object-contain" 
                            alt="Neural Scan Result" 
                          />
                          <svg 
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox={viewBox}
                            preserveAspectRatio="xMidYMid meet"
                          >
                            {/* Render Masks */}
                            {filteredMasks.map((mask, idx) => {
                              if (!mask.points || mask.points.length < 3) return null;
                              const colorObj = getColorForLabel(mask.label);
                              let p0 = mask.points[0];
                              let p1 = mask.points[1];
                              let d = `M ${(p0[0]+p1[0])/2},${(p0[1]+p1[1])/2}`;
                              for (let i = 1; i <= mask.points.length; i++) {
                                let current = mask.points[i % mask.points.length];
                                let next = mask.points[(i + 1) % mask.points.length];
                                let midX = (current[0] + next[0]) / 2;
                                let midY = (current[1] + next[1]) / 2;
                                d += ` Q ${current[0]},${current[1]} ${midX},${midY}`;
                              }
                              return (
                                <g key={`rep-mask-${idx}`}>
                                  <path
                                    d={d}
                                    fill={`rgba(${colorObj.rgb}, 0.4)`}
                                  />
                                  <text 
                                    x={mask.points[0][0]} 
                                    y={mask.points[0][1] - 5} 
                                    fill="white" fontSize="14" fontWeight="bold" className="uppercase font-mono"
                                  >
                                    #{idx + 1} {mask.label.replace('_', ' ')}
                                  </text>
                                </g>
                              );
                            })}
                            {/* Render Boxes */}
                            {filteredBoxes.map((box, idx) => {
                              if (!box.xyxy) return null;
                              const [x1, y1, x2, y2] = box.xyxy;
                              const w = x2 - x1;
                              const h = y2 - y1;
                              const imageWidthPx = imgRef.current ? imgRef.current.naturalWidth : 1;
                              const mmPerPx = 150 / imageWidthPx;
                              const sizeMm = (Math.max(w, h) * mmPerPx).toFixed(1);
                              const colorObj = getColorForLabel(box.label);
                              const labelText = `${box.label.replace('_', ' ')} ${sizeMm}mm (${(box.confidence * 100).toFixed(0)}%)`;
                              const textWidth = Math.max(labelText.length * 6 + 10, 50);
                              const textHeight = 16;
                              const yPos = Math.max(0, y1 - textHeight);
                              return (
                                <g key={`rep-box-${idx}`}>
                                  <rect
                                    x={x1} y={y1} width={w} height={h}
                                    fill={`rgba(${colorObj.rgb}, 0.2)`}
                                    stroke={colorObj.hex}
                                    strokeWidth="2"
                                    style={{ filter: `drop-shadow(0 0 3px rgba(${colorObj.rgb}, 0.5))` }}
                                  />
                                  <rect
                                    x={x1} y={yPos} width={textWidth} height={textHeight} rx="3"
                                    fill={`rgba(${colorObj.rgb}, 0.95)`}
                                    stroke={colorObj.hex}
                                    strokeWidth="1"
                                  />
                                  <text
                                    x={x1 + 5} y={yPos + 12}
                                    className="label-text capitalize font-mono font-bold fill-white text-[10px]"
                                  >
                                    {labelText}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        </>
                      ) : (
                        <div className="text-slate-500 font-mono text-[10px] uppercase tracking-widest">Image Data Not Found</div>
                      )}
                    </div>
                  </div>

                  {/* Findings Table */}
                  <div className="space-y-6">

                    <div className="flex items-center justify-between border-l-[6px] border-red-600 pl-4">
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em]">II. AI Analysis Matrix</h3>
                      <span className="text-[10px] text-slate-400 font-bold uppercase italic">Audit Record</span>
                    </div>
                    <div className="border border-slate-100 rounded-sm overflow-hidden shadow-sm">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50/50 text-slate-500 text-[9px] uppercase font-black">
                          <tr>
                            <th className="px-6 py-4">Classification</th>
                            <th className="px-6 py-4">Standard & Explication</th>
                            <th className="px-6 py-4 text-right">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filteredDetections.map((det, i) => {
                            const data = DEFECT_STANDARDS[det.label.toLowerCase()] || DEFECT_STANDARDS['defect'];
                            return (
                              <tr key={i} className="group hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#{i+1}</span>
                                    <span className="font-bold text-slate-900 capitalize">{det.label.replace('_', ' ')}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-[10px] font-black text-red-600 mb-0.5">{data.std}</div>
                                  <div className="text-slate-500 italic leading-snug">{data.desc}</div>
                                </td>
                                <td className="px-6 py-4 text-right text-slate-400 font-mono">
                                  {(det.confidence * 100).toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                          {filteredDetections.length === 0 && (
                            <tr>
                              <td colSpan="3" className="px-6 py-10 text-center text-slate-400 italic font-medium">Clear scan. No anomalies detected in current neural layer.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>


                  {/* Editable Observations */}
                  <div className="space-y-6 flex-1 flex flex-col">
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-[0.2em] border-l-[6px] border-red-600 pl-4">III. Inspector Observations</h3>
                    <div className="flex-1 bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-lg p-8 relative min-h-[300px]">
                      <div className="absolute top-4 right-4 bg-white px-3 py-1 rounded-full border border-slate-200 text-[8px] font-black uppercase tracking-widest text-blue-600 shadow-sm">
                        Manual Entry Mode
                      </div>
                      <textarea 
                        value={reportNotes}
                        onChange={(e) => setReportNotes(e.target.value)}
                        className="w-full h-full bg-transparent text-sm text-slate-800 outline-none resize-none leading-relaxed border-none focus:ring-0 p-0 font-medium italic"
                        placeholder="Please enter official inspection notes here..."
                      />
                    </div>
                  </div>
                </div>

                {/* Footer Metadata */}
                <div className="p-12 border-t border-slate-100 flex justify-between items-center bg-slate-50/30">
                  <div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest leading-loose">
                    Generated by Industrial Inspection Hub AI System<br/>
                    Digital Signature: {String(currentInspectionId || '').slice(0, 16)}
                  </div>
                  <div className="w-16 h-16 opacity-10 grayscale brightness-0">
                    <svg viewBox="0 0 100 100" fill="currentColor"><circle cx="50" cy="50" r="50"/></svg>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ModelDetailsModal 
        isOpen={isTrafficModalOpen} 
        onClose={() => setIsTrafficModalOpen(false)} 
        model={selectedTraffic} 
        apiUrl={API_URL}
        userId={userId}
      />

      {/* Login Modal */}
      <AnimatePresence>
        {showLogin && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card max-w-sm w-full p-10 border-red-500/30 text-center"
            >
              <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-800 rounded-3xl mx-auto mb-8 flex items-center justify-center shadow-[0_0_30px_rgba(220,38,38,0.3)]">
                 <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"></path></svg>
              </div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">
                {isRegisterMode ? "Create Identity" : "Initialize Node"}
              </h2>
              <p className="text-slate-500 text-sm mb-8 font-medium">
                {isRegisterMode ? "Register as a new inspector." : "Enter your inspector identity to proceed."}
              </p>
              
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="USERNAME"
                  disabled={isLoggingIn}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-4 text-center text-sm text-white font-mono uppercase tracking-widest focus:outline-none focus:border-red-500 transition-all disabled:opacity-50"
                />
                <input 
                  type="password" 
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (isRegisterMode ? handleRegister() : handleLogin())}
                  placeholder="PASSWORD"
                  disabled={isLoggingIn}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-4 text-center text-sm text-white font-mono uppercase tracking-widest focus:outline-none focus:border-red-500 transition-all disabled:opacity-50"
                />
                {loginError && <p className="text-red-500 text-xs font-bold">{loginError}</p>}
                
                <button 
                  onClick={isRegisterMode ? handleRegister : handleLogin}
                  disabled={isLoggingIn}
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-widest py-4 rounded-xl shadow-lg shadow-red-900/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isLoggingIn ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Processing...
                    </>
                  ) : (
                    isRegisterMode ? "Register Account" : "Sign In"
                  )}
                </button>

                <button 
                  onClick={() => {
                    setIsRegisterMode(!isRegisterMode);
                    setLoginError('');
                  }}
                  className="text-[10px] text-slate-500 hover:text-white uppercase font-black tracking-widest transition-colors mt-2"
                >
                  {isRegisterMode ? "Already have an account? Sign In" : "Need an account? Register here"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Correction & Retraining Studio Modal */}
      <AnimatePresence>
        {isRetrainStudioOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-md">
            <div className="w-full max-w-7xl h-[90vh] bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-2xl shadow-slate-200/50">
              
              {/* Header */}
              <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Correction & Retraining Studio</h2>
                  <span className="text-[10px] font-bold font-mono bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md border border-slate-300/50">
                    {retrainBoxes.length} {retrainBoxes.length === 1 ? 'LABEL' : 'LABELS'}
                  </span>
                </div>
                <button 
                  type="button"
                  onClick={closeRetrainStudioWithSync}
                  className="p-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Workspace */}
              <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
                
                {/* Image & Canvas Section */}
                <div className="lg:col-span-8 h-full flex items-center justify-center relative bg-slate-950 rounded-xl border border-slate-200 overflow-hidden select-none">
                  {imagePreview && (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <img 
                        src={imagePreview} 
                        onLoad={handleRetrainImageLoad}
                        className="max-w-full max-h-full object-contain pointer-events-none"
                        alt="Retrain Source" 
                      />
                      <svg 
                        ref={retrainSvgRef}
                        viewBox={retrainViewBox}
                        preserveAspectRatio="xMidYMid meet"
                        onMouseDown={handleRetrainMouseDown}
                        onMouseMove={handleRetrainMouseMove}
                        onMouseUp={handleRetrainMouseUp}
                        className="absolute inset-0 w-full h-full cursor-crosshair"
                      >
                        {/* Render drawn labels */}
                        {retrainBoxes.map((box, idx) => {
                          if (box.hidden) return null;
                          const colorClass = RETRAIN_CLASSES.find(c => c.id === box.label) || { color: "#ef4444", rgb: "239,68,68" };
                          
                          if (box.type === "mask" && box.points) {
                            return (
                              <g key={`retrain-box-${idx}`}>
                                <polygon
                                  points={box.points.map(pt => pt.join(',')).join(' ')}
                                  fill={`rgba(${colorClass.rgb}, 0.25)`}
                                  stroke={colorClass.color}
                                  strokeWidth="2"
                                />
                                {box.xyxy && (
                                  <>
                                    <rect
                                      x={box.xyxy[0]}
                                      y={Math.max(0, box.xyxy[1] - 15)}
                                      width={box.label.length * 6 + 12}
                                      height={15}
                                      fill={colorClass.color}
                                      rx="2"
                                    />
                                    <text
                                      x={box.xyxy[0] + 4}
                                      y={Math.max(0, box.xyxy[1] - 15) + 11}
                                      fill="white"
                                      fontSize="9"
                                      fontWeight="bold"
                                      className="capitalize font-mono"
                                    >
                                      {box.label.replace('_', ' ')}
                                    </text>
                                  </>
                                )}
                              </g>
                            );
                          } else if (box.xyxy) {
                            const [x1, y1, x2, y2] = box.xyxy;
                            const w = x2 - x1;
                            const h = y2 - y1;
                            return (
                              <g key={`retrain-box-${idx}`}>
                                <rect
                                  x={x1}
                                  y={y1}
                                  width={w}
                                  height={h}
                                  fill={`rgba(${colorClass.rgb}, 0.25)`}
                                  stroke={colorClass.color}
                                  strokeWidth="2"
                                />
                                <rect
                                  x={x1}
                                  y={Math.max(0, y1 - 15)}
                                  width={box.label.length * 6 + 12}
                                  height={15}
                                  fill={colorClass.color}
                                  rx="2"
                                />
                                <text
                                  x={x1 + 4}
                                  y={Math.max(0, y1 - 15) + 11}
                                  fill="white"
                                  fontSize="9"
                                  fontWeight="bold"
                                  className="capitalize font-mono"
                                >
                                  {box.label.replace('_', ' ')}
                                </text>
                              </g>
                            );
                          }
                          return null;
                        })}

                        {/* Dragging preview */}
                        {retrainIsDrawing && retrainDrawMode === 'box' && (
                          <rect
                            x={Math.min(retrainStartPos.x, retrainCurrentPos.x)}
                            y={Math.min(retrainStartPos.y, retrainCurrentPos.y)}
                            width={Math.abs(retrainCurrentPos.x - retrainStartPos.x)}
                            height={Math.abs(retrainCurrentPos.y - retrainStartPos.y)}
                            fill="rgba(6, 182, 212, 0.15)"
                            stroke="#06b6d4"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                          />
                        )}

                        {retrainIsDrawing && retrainDrawMode === 'segment' && retrainPoints.length > 0 && (
                          <polygon
                            points={retrainPoints.map(pt => pt.join(',')).join(' ')}
                            fill="rgba(6, 182, 212, 0.15)"
                            stroke="#06b6d4"
                            strokeWidth="2"
                            strokeDasharray="4 4"
                          />
                        )}
                      </svg>
                    </div>
                  )}
                </div>

                {/* Sidebar controls & active labels list */}
                <div className="lg:col-span-4 h-full flex flex-col overflow-hidden bg-slate-50 border border-slate-200 rounded-xl">
                  
                  {/* Tool Options */}
                  <div className="p-4 border-b border-slate-200 space-y-4 flex-shrink-0">
                    <div>
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Drawing Tool Mode</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setRetrainDrawMode('box')}
                          className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${retrainDrawMode === 'box' ? 'bg-red-600 border-red-600 text-white shadow-md shadow-red-600/10' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                          Bounding Box
                        </button>
                        <button
                          type="button"
                          onClick={() => setRetrainDrawMode('segment')}
                          className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border ${retrainDrawMode === 'segment' ? 'bg-red-600 border-red-600 text-white shadow-md shadow-red-600/10' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                          Segmentation Mask
                        </button>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Defect Category</h3>
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {getRetrainClasses().map(cls => (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => setRetrainClass(cls.id)}
                            className={`py-1.5 px-2.5 rounded-lg text-[10px] font-bold text-left transition-all border flex items-center gap-2 ${retrainClass === cls.id ? 'bg-white border-slate-300 text-slate-800 shadow-sm' : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200/60'}`}
                          >
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cls.color }} />
                            <span className="truncate">{cls.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Active Labels List */}
                  <div className="flex-1 overflow-y-auto p-4 min-h-0 flex flex-col">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex-shrink-0">Active Labels ({retrainBoxes.length})</h3>
                    <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                      {retrainBoxes.map((box, idx) => {
                        const colorClass = RETRAIN_CLASSES.find(c => c.id === box.label) || { color: "#ef4444", name: box.label };
                        return (
                          <div 
                            key={idx}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${box.hidden ? 'bg-slate-100 border-slate-200/60 opacity-50' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorClass.color }} />
                              <div className="truncate">
                                <div className="text-xs font-bold text-slate-700 capitalize truncate">{colorClass.name.replace('_', ' ')}</div>
                                <div className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">{box.type === 'mask' ? 'segmentation' : 'bounding box'}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleHideRetrainBox(idx)}
                                className={`p-1.5 rounded-lg transition-colors border ${box.hidden ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-200'}`}
                              >
                                {box.hidden ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteRetrainBox(idx)}
                                className="p-1.5 rounded-lg bg-slate-100 border border-slate-200 hover:border-red-200 hover:bg-red-50 text-slate-500 hover:text-red-600 transition-all"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {retrainBoxes.length === 0 && (
                        <div className="text-center py-8 text-xs text-slate-500 italic">No labels created yet. Draw on the image to add labels.</div>
                      )}
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={saveRetrainData}
                      disabled={isSavingRetrain}
                      className="btn-gradient w-full py-3 rounded-lg font-bold text-sm text-center flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSavingRetrain ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                          Saving Dataset...
                        </>
                      ) : (
                        "Save to Retraining Dataset"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={closeRetrainStudioWithSync}
                      className="w-full py-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-800 font-bold text-xs tracking-wider uppercase transition-all shadow-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>

              </div>

            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
