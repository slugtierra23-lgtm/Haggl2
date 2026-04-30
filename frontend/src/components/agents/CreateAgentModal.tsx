'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X, Bot } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { Agent } from '@/hooks/useAgentManagement';

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; webhookUrl: string }) => Promise<Agent>;
  loading?: boolean;
}

export const CreateAgentModal: React.FC<CreateAgentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    webhookUrl: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name.trim()) {
      setError('Agent name is required');
      return;
    }

    if (!formData.webhookUrl.trim()) {
      setError('Webhook URL is required');
      return;
    }

    try {
      new URL(formData.webhookUrl);
    } catch {
      setError('Invalid webhook URL');
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        webhookUrl: formData.webhookUrl.trim(),
      });
      setFormData({ name: '', description: '', webhookUrl: '' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose, submitting]);

  const inputStyle = {
    background: 'linear-gradient(180deg, rgba(8,8,12,0.8) 0%, rgba(4,4,8,0.8) 100%)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => {
            if (!submitting) onClose();
          }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative rounded-xl p-6 max-w-md w-full overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              boxShadow:
                '0 0 0 1px rgba(20, 241, 149, 0.25), inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 60px -10px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.55) 50%, transparent 100%)',
              }}
            />
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(20, 241, 149, 0.22) 0%, rgba(20, 241, 149, 0.06) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(20, 241, 149, 0.38), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 14px -4px rgba(20, 241, 149, 0.45)',
                  }}
                >
                  <Bot className="w-4 h-4 text-[#b4a7ff]" />
                </div>
                <h3 className="text-lg font-light text-white tracking-[-0.005em]">
                  Create New Agent
                </h3>
              </div>
              <motion.button
                onClick={onClose}
                disabled={submitting}
                whileHover={submitting ? undefined : { rotate: 90 }}
                whileTap={submitting ? undefined : { scale: 0.88 }}
                transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                className="text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Error Alert */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto', marginBottom: 16 }}
                  exit={{ opacity: 0, y: -4, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div
                    className="p-3 rounded-lg text-[13px] tracking-[0.005em]"
                    style={{
                      background:
                        'linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03) 100%)',
                      boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.3)',
                      color: '#fda4af',
                    }}
                  >
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                  Agent Name <span className="text-[#fda4af]">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Negotiation Bot v2"
                  disabled={submitting}
                  className="w-full px-3 py-2.5 rounded-lg text-white placeholder-zinc-600 disabled:opacity-50 focus:outline-none transition-all focus:brightness-110 text-[13px] tracking-[0.005em]"
                  style={inputStyle}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Optional description of what this agent does"
                  disabled={submitting}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-lg text-white placeholder-zinc-600 disabled:opacity-50 focus:outline-none transition-all focus:brightness-110 resize-none text-[13px] tracking-[0.005em]"
                  style={inputStyle}
                />
              </div>

              {/* Webhook URL */}
              <div>
                <label className="block text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
                  Webhook URL <span className="text-[#fda4af]">*</span>
                </label>
                <input
                  type="url"
                  value={formData.webhookUrl}
                  onChange={(e) => setFormData((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                  placeholder="https://your-server.com/webhook"
                  disabled={submitting}
                  className="w-full px-3 py-2.5 rounded-lg text-white placeholder-zinc-600 disabled:opacity-50 focus:outline-none transition-all focus:brightness-110 text-[13px] tracking-[0.005em] font-mono"
                  style={inputStyle}
                />
                <p className="text-xs text-zinc-500 mt-1.5">
                  The endpoint where webhook events will be sent
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 mt-6">
                <motion.button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  whileHover={submitting ? undefined : { y: -1 }}
                  whileTap={submitting ? undefined : { scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                  className="flex-1 px-4 py-2.5 rounded-lg text-zinc-300 hover:text-white disabled:opacity-50 transition-colors hover:brightness-110 font-light text-[13px] tracking-[0.005em]"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
                  }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  type="submit"
                  disabled={submitting}
                  whileHover={submitting ? undefined : { y: -1 }}
                  whileTap={submitting ? undefined : { scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                  className="flex-1 px-4 py-2.5 rounded-lg disabled:opacity-50 text-white font-light text-[13px] tracking-[0.005em] transition-all hover:brightness-110 flex items-center justify-center gap-2"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
                  }}
                >
                  {submitting ? (
                    <>
                      <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Agent'
                  )}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

CreateAgentModal.displayName = 'CreateAgentModal';
