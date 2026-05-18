import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, ChevronDown, Copy, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthModalProps {
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onClose }) => {
  const { currentUser, signInWithGoogle, loading, error, debugLogs } = useAuth();
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Close modal when user successfully signs in (auth state has updated)
  useEffect(() => {
    if (currentUser && !loading) {
      console.log('✅ AuthModal closing - user successfully logged in');
      onClose?.();
    }
  }, [currentUser, loading, onClose]);

  const handleSignIn = async () => {
    console.log('🔐 User clicked sign-in button, opening Google OAuth...');
    await signInWithGoogle();
  };

  const handleCopyLogs = async () => {
    const logsText = debugLogs.join('\n');
    try {
      await navigator.clipboard.writeText(logsText);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop itself, not the modal
    if (e.target === e.currentTarget && !loading && onClose) {
      console.log('User clicked backdrop to close auth modal');
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={handleBackdropClick}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-dark rounded-2xl p-8 max-w-sm w-full mx-4 border border-white/10 max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-block p-3 bg-lime/20 rounded-full mb-4">
            <LogIn className="w-6 h-6 text-lime" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">
            Sign in to Street Golf
          </h2>
          <p className="text-white/60">
            Create and share custom courses with the community
          </p>
        </div>

        {/* Error Message */}
        {error && error !== 'OPEN_IN_BROWSER' && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* PWA Fallback: popup was blocked or failed — offer to open in browser */}
        {error === 'OPEN_IN_BROWSER' && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-yellow-300 text-sm font-medium mb-3">
              Sign-in couldn't open a popup. Tap below to sign in via your browser, then come back to this app.
            </p>
            <a
              href="https://street-golf-69679.web.app/?openAuth=1"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-2 px-4 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-300 text-sm font-bold rounded-lg text-center transition-colors"
            >
              Open in Browser to Sign In
            </a>
          </div>
        )}

        {/* Google Sign-In Button */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full py-3 px-4 bg-white text-dark font-bold rounded-xl hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mb-4"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-dark/20 border-t-dark rounded-full animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </>
          )}
        </button>

        {/* Info Text */}
        <p className="text-center text-white/50 text-sm mb-6">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>

        {/* Debug Logs Panel */}
        {debugLogs.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <button
              onClick={() => setShowDebugLogs(!showDebugLogs)}
              className="w-full flex items-center justify-between p-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/70 transition-colors"
            >
              <span>🔍 Debug Info ({debugLogs.length} logs)</span>
              <ChevronDown 
                size={16}
                className={`transition-transform ${showDebugLogs ? 'rotate-180' : ''}`}
              />
            </button>
            <AnimatePresence>
              {showDebugLogs && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-2 bg-black/50 rounded-lg overflow-hidden"
                >
                  <div className="p-3 max-h-48 overflow-y-auto text-[11px] font-mono text-white/60 space-y-1">
                    {debugLogs.slice(-10).map((log, idx) => (
                      <div key={idx} className="text-white/50 hover:text-white/80 break-words">
                        {log}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleCopyLogs}
                    className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 border-t border-white/10 text-white/70 hover:text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    {copyFeedback ? (
                      <>
                        <Check size={14} className="text-lime" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={14} />
                        Copy Logs
                      </>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
