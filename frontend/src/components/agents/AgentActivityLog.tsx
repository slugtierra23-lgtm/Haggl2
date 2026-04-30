'use client';

import { motion } from 'framer-motion';
import { Activity, CheckCircle2, XCircle, Clock, AlertTriangle, Circle } from 'lucide-react';
import React from 'react';

import type { AgentActivityLogEntry } from '@/hooks/useAgentManagement';

interface AgentActivityLogProps {
  activities: AgentActivityLogEntry[];
  loading?: boolean;
}

const statusMeta = {
  SUCCESS: { color: '34,197,94', textColor: '#86efac', icon: CheckCircle2 },
  FAILED: { color: '239,68,68', textColor: '#fda4af', icon: XCircle },
  PENDING: { color: '245,158,11', textColor: '#fcd34d', icon: Clock },
  TIMEOUT: { color: '249,115,22', textColor: '#fdba74', icon: AlertTriangle },
} as const;

export const AgentActivityLog: React.FC<AgentActivityLogProps> = ({ activities, loading }) => {
  const getMeta = (status: AgentActivityLogEntry['status']) => {
    return (
      statusMeta[status as keyof typeof statusMeta] || {
        color: '161,161,170',
        textColor: '#d4d4d8',
        icon: Circle,
      }
    );
  };

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-4 rounded-xl animate-pulse"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06)',
            }}
          >
            <div className="h-4 bg-white/[0.06] rounded w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div
        className="relative p-12 rounded-xl text-center overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.4) 50%, transparent 100%)',
          }}
        />
        <div
          className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
            boxShadow:
              'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 18px -4px rgba(20, 241, 149, 0.5)',
          }}
        >
          <Activity className="w-5 h-5 text-[#b4a7ff]" />
        </div>
        <p className="text-[13px] text-zinc-400 tracking-[0.005em]">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity, idx) => {
        const meta = getMeta(activity.status);
        const Icon = meta.icon;
        return (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: Math.min(idx * 0.035, 0.25),
              duration: 0.26,
              ease: [0.22, 0.61, 0.36, 1],
            }}
            whileHover={{ y: -2 }}
            className="relative p-4 rounded-xl overflow-hidden transition-colors hover:brightness-110"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(${meta.color},0.4) 50%, transparent 100%)`,
              }}
            />
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, rgba(${meta.color},0.22) 0%, rgba(${meta.color},0.06) 100%)`,
                  boxShadow: `inset 0 0 0 1px rgba(${meta.color},0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 14px -4px rgba(${meta.color},0.45)`,
                }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: meta.textColor }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-light text-white tracking-[0.005em]">
                    {activity.action}
                  </p>
                  <span className="text-[11px] text-zinc-500 flex-shrink-0 tabular-nums">
                    {formatTime(activity.createdAt)}
                  </span>
                </div>

                {activity.responseTime && (
                  <p className="text-[11px] text-zinc-500 mt-1 tabular-nums tracking-[0.005em]">
                    Response time: {activity.responseTime}ms
                  </p>
                )}

                {activity.metadata &&
                  typeof activity.metadata === 'object' &&
                  Object.keys(activity.metadata).length > 0 && (
                    <details className="mt-2 cursor-pointer">
                      <summary className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                        Details
                      </summary>
                      <pre
                        className="mt-2 p-2 rounded-lg text-[11px] text-zinc-300 overflow-auto max-h-40 font-mono"
                        style={{
                          background:
                            'linear-gradient(180deg, rgba(8,8,12,0.8) 0%, rgba(4,4,8,0.8) 100%)',
                          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                        }}
                      >
                        {JSON.stringify(activity.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

AgentActivityLog.displayName = 'AgentActivityLog';
