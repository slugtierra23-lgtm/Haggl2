'use client';

import { motion } from 'framer-motion';
import {
  LogIn,
  KeyRound,
  Settings,
  Download,
  Shield,
  Zap,
  FileText,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import React from 'react';

type EventType =
  | 'login'
  | 'api_key'
  | 'settings'
  | 'download'
  | 'security'
  | 'deployment'
  | 'file'
  | 'warning';

interface ActivityEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  timestamp: string;
  metadata?: Record<string, string>;
}

interface ActivityLogSectionProps {
  events: ActivityEvent[];
  onExport?: () => Promise<void>;
}

interface EventConfig {
  icon: LucideIcon;
  color: string;
  textColor: string;
}

const eventConfig: Record<EventType, EventConfig> = {
  login: { icon: LogIn, color: '59,130,246', textColor: '#93c5fd' },
  api_key: { icon: KeyRound, color: '16,185,129', textColor: 'var(--brand)' },
  settings: { icon: Settings, color: '161,161,170', textColor: '#d4d4d8' },
  download: { icon: Download, color: '34,197,94', textColor: '#86efac' },
  security: { icon: Shield, color: '245,158,11', textColor: '#fcd34d' },
  deployment: { icon: Zap, color: '249,115,22', textColor: '#fdba74' },
  file: { icon: FileText, color: '99,102,241', textColor: '#a5b4fc' },
  warning: { icon: AlertCircle, color: '239,68,68', textColor: '#fda4af' },
};

export const ActivityLogSection: React.FC<ActivityLogSectionProps> = ({ events, onExport }) => {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) {
        const diffMins = Math.floor(diffMs / (1000 * 60));
        return `${diffMins}m ago`;
      }
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="profile-content-card space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-light text-white">Activity Log</h2>
          <p className="text-sm text-gray-400 mt-1">Your recent account activity</p>
        </div>
        {onExport && (
          <motion.button
            onClick={onExport}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="px-4 py-2 rounded-lg text-[13px] font-light tracking-[0.005em] text-zinc-300 hover:text-white hover:brightness-110 transition-colors flex items-center gap-2"
            style={{
              background: 'linear-gradient(180deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
              boxShadow: 'inset 0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
            }}
          >
            <Download className="w-4 h-4" />
            Export
          </motion.button>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {events.length === 0 ? (
          <div
            className="relative p-12 rounded-xl text-center overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              boxShadow: '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
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
              className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                boxShadow:
                  'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 var(--bg-card2), 0 0 18px -4px rgba(20, 241, 149, 0.5)',
              }}
            >
              <FileText className="w-5 h-5 text-[#b4a7ff]" />
            </div>
            <p className="text-[13px] text-zinc-400 tracking-[0.005em] mb-1">No activity yet</p>
            <p className="text-xs text-zinc-500">Your account activity will appear here</p>
          </div>
        ) : (
          events.map((event, index) => {
            const config = eventConfig[event.type];
            const Icon = config.icon;

            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: Math.min(index * 0.035, 0.3),
                  duration: 0.28,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
                className="relative"
              >
                {/* Timeline connector */}
                {index < events.length - 1 && (
                  <div
                    className="absolute left-[23px] top-12 w-px h-4"
                    style={{
                      background: 'linear-gradient(180deg, var(--border) 0%, transparent 100%)',
                    }}
                  />
                )}

                {/* Event item */}
                <div className="flex gap-3 pb-2">
                  {/* Icon chip */}
                  <div
                    className="relative flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, rgba(${config.color},0.22) 0%, rgba(${config.color},0.06) 100%)`,
                      boxShadow: `inset 0 0 0 1px rgba(${config.color},0.38), inset 0 1px 0 var(--bg-card2), 0 0 14px -4px rgba(${config.color},0.45)`,
                    }}
                  >
                    <Icon className="w-4 h-4" style={{ color: config.textColor }} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[14px] font-light text-white tracking-[0.005em]">
                          {event.title}
                        </h3>
                        <p className="text-[12px] text-zinc-400 mt-0.5 tracking-[0.005em]">
                          {event.description}
                        </p>
                      </div>
                      <span className="text-[11px] text-zinc-500 whitespace-nowrap flex-shrink-0 tabular-nums">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>

                    {/* Metadata */}
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(event.metadata).map(([key, value]) => (
                          <span
                            key={key}
                            className="text-[11px] px-2 py-1 rounded-md text-zinc-400 font-mono tracking-[0.005em]"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(40,40,48,0.55) 0%, var(--bg-card) 100%)',
                              boxShadow: 'inset 0 0 0 1px var(--bg-card2)',
                            }}
                          >
                            {key}: <span className="text-zinc-200">{value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Load more hint */}
      {events.length > 0 && (
        <div className="pt-4 border-t border-white/[0.06] text-center">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="text-[13px] font-light tracking-[0.005em] text-[#b4a7ff] hover:text-white transition-colors"
          >
            Load more activity
          </motion.button>
        </div>
      )}
    </div>
  );
};

ActivityLogSection.displayName = 'ActivityLogSection';
