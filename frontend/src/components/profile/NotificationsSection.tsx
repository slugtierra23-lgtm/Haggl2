'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Mail, AlertCircle, CheckCircle, Bell, type LucideIcon } from 'lucide-react';
import React, { useState } from 'react';

interface NotificationSettings {
  emailOnErrors: boolean;
  weeklyReport: boolean;
  monthlyReport: boolean;
  deploymentAlerts: boolean;
}

interface NotificationsSectionProps {
  settings: NotificationSettings;
  email: string;
  onUpdate: (settings: NotificationSettings) => Promise<void>;
}

interface NotificationOption {
  key: keyof NotificationSettings;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
  textColor: string;
}

export const NotificationsSection: React.FC<NotificationsSectionProps> = ({
  settings,
  email,
  onUpdate,
}) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleToggle = (key: keyof NotificationSettings) => {
    const updated = { ...localSettings, [key]: !localSettings[key] };
    setLocalSettings(updated);
  };

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    try {
      await onUpdate(localSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  const notificationOptions: NotificationOption[] = [
    {
      key: 'emailOnErrors',
      icon: AlertCircle,
      title: 'Email on API Errors',
      description: 'Get alerts for failed requests or rate limit warnings',
      color: '239,68,68',
      textColor: '#fda4af',
    },
    {
      key: 'weeklyReport',
      icon: Mail,
      title: 'Weekly Usage Report',
      description: `Summary of your API usage sent to ${email}`,
      color: '6,182,212',
      textColor: '#67e8f9',
    },
    {
      key: 'monthlyReport',
      icon: Bell,
      title: 'Monthly Newsletter',
      description: 'Product updates, tips, and new features',
      color: '245,158,11',
      textColor: '#fcd34d',
    },
    {
      key: 'deploymentAlerts',
      icon: CheckCircle,
      title: 'Deployment Alerts',
      description: 'Notifications when your agents are deployed or updated',
      color: '34,197,94',
      textColor: '#86efac',
    },
  ];

  const hasChanges = JSON.stringify(localSettings) !== JSON.stringify(settings);

  return (
    <div className="profile-content-card space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-light text-white">Notifications</h2>
        <p className="text-sm text-gray-400 mt-1">Manage how you receive updates and alerts</p>
      </div>

      {/* Success Message */}
      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="relative p-3 rounded-lg flex items-center gap-2 overflow-hidden"
              style={{
                background:
                  'linear-gradient(180deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.03) 100%)',
                boxShadow: 'inset 0 0 0 1px rgba(34,197,94,0.3)',
              }}
            >
              <CheckCircle className="w-4 h-4 text-[#86efac] flex-shrink-0" />
              <p className="text-[13px] text-[#86efac] tracking-[0.005em]">
                Notification preferences saved successfully
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification Options */}
      <div className="space-y-3">
        {notificationOptions.map(
          ({ key, icon: Icon, title, description, color, textColor }, idx) => {
            const isEnabled = localSettings[key];
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: Math.min(idx * 0.04, 0.2),
                  duration: 0.26,
                  ease: [0.22, 0.61, 0.36, 1],
                }}
                className="relative p-4 rounded-xl overflow-hidden transition-all hover:brightness-110"
                style={{
                  background: 'var(--bg-card)',
                  boxShadow: '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, rgba(${color},0.4) 50%, transparent 100%)`,
                  }}
                />
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `linear-gradient(135deg, rgba(${color},0.22) 0%, rgba(${color},0.06) 100%)`,
                      boxShadow: `inset 0 0 0 1px rgba(${color},0.38), inset 0 1px 0 var(--bg-card2), 0 0 14px -4px rgba(${color},0.45)`,
                    }}
                  >
                    <Icon className="w-4 h-4" style={{ color: textColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[14px] font-light text-white tracking-[0.005em]">
                          {title}
                        </h3>
                        <p className="text-[12px] text-zinc-400 mt-1 tracking-[0.005em]">
                          {description}
                        </p>
                      </div>
                      <motion.button
                        type="button"
                        onClick={() => handleToggle(key)}
                        disabled={loading}
                        role="switch"
                        aria-checked={isEnabled}
                        whileTap={loading ? undefined : { scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                        className="relative w-10 h-5.5 rounded-full flex-shrink-0 transition-all disabled:opacity-50"
                        style={{
                          background: isEnabled
                            ? 'linear-gradient(180deg, rgba(20, 241, 149, 0.8) 0%, rgba(20, 241, 149, 0.55) 100%)'
                            : 'linear-gradient(180deg, rgba(40,40,48,0.9) 0%, rgba(24,24,30,0.9) 100%)',
                          boxShadow: isEnabled
                            ? 'inset 0 0 0 1px rgba(20, 241, 149, 0.6), inset 0 1px 0 var(--border), 0 0 14px -2px rgba(20, 241, 149, 0.5)'
                            : 'inset 0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                          width: '40px',
                          height: '22px',
                        }}
                      >
                        <motion.span
                          layout
                          className="absolute top-[3px] w-4 h-4 rounded-full bg-white"
                          animate={{ left: isEnabled ? '21px' : '3px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                          style={{
                            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                          }}
                        />
                      </motion.button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          },
        )}
      </div>

      {/* Email Preferences */}
      <div
        className="relative p-4 rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          boxShadow: '0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(20, 241, 149, 0.35) 50%, transparent 100%)',
          }}
        />
        <p className="text-[10.5px] uppercase tracking-[0.18em] font-medium text-zinc-500 mb-2">
          Email Address
        </p>
        <p className="text-sm text-white font-light tracking-[0.005em] break-all">{email}</p>
        <p className="text-xs text-zinc-500 mt-2">
          All notifications will be sent to this email address
        </p>
      </div>

      {/* Save Button */}
      <AnimatePresence>
        {hasChanges && (
          <motion.div
            initial={{ opacity: 0, y: 6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 6, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex gap-3">
              <motion.button
                onClick={handleSave}
                disabled={loading}
                whileHover={loading ? undefined : { y: -1 }}
                whileTap={loading ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="flex-1 px-4 py-2.5 text-white rounded-lg font-light text-[13px] tracking-[0.005em] transition-all hover:brightness-110 disabled:opacity-50"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(20, 241, 149, 0.38) 0%, rgba(20, 241, 149, 0.14) 100%)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(20, 241, 149, 0.48), inset 0 1px 0 var(--bg-card2), 0 0 22px -4px rgba(20, 241, 149, 0.55)',
                }}
              >
                {loading ? 'Saving...' : 'Save Preferences'}
              </motion.button>
              <motion.button
                onClick={() => setLocalSettings(settings)}
                disabled={loading}
                whileHover={loading ? undefined : { y: -1 }}
                whileTap={loading ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="flex-1 px-4 py-2.5 text-zinc-300 rounded-lg font-light text-[13px] tracking-[0.005em] transition-all hover:brightness-110 hover:text-white disabled:opacity-50"
                style={{
                  background: 'linear-gradient(180deg, rgba(40,40,48,0.7) 0%, var(--bg-card) 100%)',
                  boxShadow: 'inset 0 0 0 1px var(--bg-card2), inset 0 1px 0 var(--bg-card2)',
                }}
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

NotificationsSection.displayName = 'NotificationsSection';
