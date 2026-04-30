'use client';

import { motion } from 'framer-motion';
import React from 'react';

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  isLoading?: boolean;
  isSaving?: boolean;
}

export function FormSection({
  title,
  description,
  children,
  onSubmit,
  isLoading,
  isSaving,
}: FormSectionProps) {
  return (
    <motion.form
      onSubmit={onSubmit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      className="profile-form-section space-y-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04, duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <h2 className="text-2xl font-light text-[var(--text)] mb-2 tracking-[-0.01em]">{title}</h2>
        {description && (
          <p className="text-sm text-[var(--text-secondary)] tracking-[0.005em]">{description}</p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
        className="profile-card"
      >
        <div className="space-y-6">{children}</div>
      </motion.div>

      {onSubmit && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
          className="flex justify-end gap-3"
        >
          <motion.button
            type="submit"
            disabled={isLoading || isSaving}
            whileTap={isLoading || isSaving ? undefined : { scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            className="atlas-cta px-5 h-10 rounded-xl font-semibold text-[13px] tracking-tight disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </motion.button>
        </motion.div>
      )}
    </motion.form>
  );
}
