'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

import type { Agent } from '@/hooks/useAgentManagement';

interface AgentSelectorProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onCreateNew?: () => void;
  onDeleteAgent?: (id: string) => Promise<void>;
  loading?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onCreateNew,
  onDeleteAgent,
  loading = false,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const handleDelete = async (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    if (!onDeleteAgent) return;

    if (!confirm('Delete this agent?')) return;

    try {
      setDeletingId(agentId);
      await onDeleteAgent(agentId);
    } finally {
      setDeletingId(null);
      setIsDropdownOpen(false);
    }
  };

  const surfaceStyle = {
    background: 'var(--bg-card)',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
  };

  if (loading) {
    return (
      <div className="p-4 rounded-xl" style={surfaceStyle}>
        <div className="h-10 bg-white/[0.06] rounded animate-pulse" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="p-4 rounded-xl text-center" style={surfaceStyle}>
        <p className="text-[13px] text-zinc-400 mb-3 tracking-[0.005em]">No agents created yet</p>
        {onCreateNew && (
          <motion.button
            onClick={onCreateNew}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-white font-light text-[13px] tracking-[0.005em] transition-all hover:brightness-110"
            style={{
              background:
                'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
              boxShadow:
                'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
            }}
          >
            <Plus className="w-4 h-4" />
            Create First Agent
          </motion.button>
        )}
      </div>
    );
  }

  const getStatusColor = (status: Agent['status']) => {
    if (status === 'ACTIVE') return '34,197,94';
    if (status === 'ERROR') return '239,68,68';
    if (status === 'TESTING') return '245,158,11';
    return '161,161,170';
  };

  return (
    <div className="relative">
      <motion.button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        whileTap={{ scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:brightness-110 text-left"
        style={surfaceStyle}
      >
        <div className="flex-1 min-w-0">
          {selectedAgent ? (
            <>
              <div className="text-[14px] font-light text-white truncate tracking-[0.005em]">
                {selectedAgent.name}
              </div>
              <div className="text-[11px] text-zinc-500 truncate font-mono tracking-[0.005em] mt-0.5">
                {selectedAgent.webhookUrl}
              </div>
            </>
          ) : (
            <div className="text-[13px] text-zinc-400 tracking-[0.005em]">Select an agent</div>
          )}
        </div>
        <motion.span
          animate={{ rotate: isDropdownOpen ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          className="flex-shrink-0 ml-2"
        >
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {isDropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl overflow-hidden origin-top"
              style={{
                background: 'var(--bg-card)',
                boxShadow:
                  '0 0 0 1px rgba(20, 241, 149, 0.2), inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 60px -10px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="max-h-96 overflow-y-auto">
                {agents.map((agent, idx) => {
                  const statusColor = getStatusColor(agent.status);
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <motion.button
                      key={agent.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: Math.min(idx * 0.025, 0.15),
                        duration: 0.2,
                        ease: [0.22, 0.61, 0.36, 1],
                      }}
                      onClick={() => {
                        onSelectAgent(agent.id);
                        setIsDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 border-b border-white/[0.04] last:border-b-0 transition-all hover:bg-white/[0.03]"
                      style={
                        isSelected
                          ? {
                              background:
                                'linear-gradient(180deg, rgba(20, 241, 149, 0.18) 0%, rgba(20, 241, 149, 0.04) 100%)',
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-[14px] font-light truncate tracking-[0.005em] ${isSelected ? 'text-[#b4a7ff]' : 'text-white'}`}
                          >
                            {agent.name}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate font-mono tracking-[0.005em] mt-0.5">
                            {agent.webhookUrl}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{
                                background: `rgb(${statusColor})`,
                                boxShadow: `0 0 8px rgba(${statusColor},0.6)`,
                              }}
                            />
                            <span
                              className="text-[10.5px] uppercase tracking-[0.18em] font-medium"
                              style={{ color: `rgb(${statusColor})` }}
                            >
                              {agent.status}
                            </span>
                          </div>
                        </div>
                        {onDeleteAgent && (
                          <motion.button
                            onClick={(e) => handleDelete(e, agent.id)}
                            disabled={deletingId === agent.id}
                            whileHover={deletingId === agent.id ? undefined : { y: -1 }}
                            whileTap={deletingId === agent.id ? undefined : { scale: 0.92 }}
                            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                            className="p-2 rounded-lg transition-colors hover:brightness-110 text-zinc-400 hover:text-[#fda4af] disabled:opacity-50"
                            style={{
                              background:
                                'linear-gradient(180deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
                              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                            }}
                          >
                            {deletingId === agent.id ? (
                              <div className="w-3.5 h-3.5 border border-[#fda4af] border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </motion.button>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {onCreateNew && (
                <>
                  <div className="border-t border-white/[0.06]" />
                  <motion.button
                    onClick={() => {
                      onCreateNew();
                      setIsDropdownOpen(false);
                    }}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    className="w-full px-4 py-3 text-left text-[13px] text-[#b4a7ff] hover:text-white hover:bg-white/[0.03] transition-colors flex items-center gap-2 tracking-[0.005em]"
                  >
                    <Plus className="w-4 h-4" />
                    Create New Agent
                  </motion.button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

AgentSelector.displayName = 'AgentSelector';
