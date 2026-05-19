// ---------------------------------------------------------------------------
// Auth architecture: Firebase popup-based OAuth
//
// Uses signInWithPopup for browser/web mode.
// Simple and works everywhere (localhost, GitHub Pages, browser).
// No PWA standalone mode - app opens in browser with address bar.
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
} from '../config/firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
}

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  debugLogs: string[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper function to log to both console and localStorage
const logToStorage = (message: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[${timestamp}] ${message}`;
  console.log(fullMessage);
  
  const isImportant = message.includes('❌') || message.includes('✅') || message.includes('🔐') || message.includes('Error');
  if (!isImportant) return;
  
  try {
    let logs = JSON.parse(localStorage.getItem('authDebugLogs') || '[]') as string[];
    logs.push(fullMessage);
    if (logs.length > 50) logs = logs.slice(-50);
    localStorage.setItem('authDebugLogs', JSON.stringify(logs));
  } catch (e) {
    // Ignore
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const signInWithGoogle = async () => {
    try {
      setError(null);
      logToStorage('🔐 Starting Google sign-in...');

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      // Use popup mode everywhere to avoid cross-domain redirect issues
      // (GitHub Pages + Firebase auth handler on different domains)
      logToStorage('🔐 Using popup auth...');
      await signInWithPopup(auth, provider);
      logToStorage('✅ Signed in via popup');
    } catch (err: any) {
      logToStorage(`❌ Sign-in error: ${err?.message}`);
      setError(err?.message || 'Failed to sign in with Google.');
    }
  };

  const logout = async () => {
    try {
      setError(null);
      logToStorage('🔐 Logging out...');
      await signOut(auth);
      setCurrentUser(null);
      setUserProfile(null);
      logToStorage('✅ Logged out successfully');
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to log out';
      setError(errorMessage);
      logToStorage(`❌ Logout Error: ${errorMessage}`);
    }
  };

  // Sync debug logs from localStorage
  useEffect(() => {
    const updateLogs = () => {
      try {
        const logs = JSON.parse(localStorage.getItem('authDebugLogs') || '[]') as string[];
        setDebugLogs(logs);
      } catch (e) {
        // Ignore
      }
    };
    
    updateLogs();
    const interval = setInterval(updateLogs, 500);
    return () => clearInterval(interval);
  }, []);

  // Listen to auth state changes
  useEffect(() => {
    logToStorage('🔐 Setting up auth state listener...');
    let unsubscribed = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (unsubscribed) return;

      if (user) {
        logToStorage(`✅ Auth state changed - user logged in: ${user.email}`);
        setCurrentUser(user);

        // Fetch user profile from Firestore
        try {
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as UserProfile);
            logToStorage('✅ User profile loaded from Firestore');
          }
        } catch (err) {
          logToStorage(`⚠️ Could not fetch user profile: ${err}`);
        }
      } else {
        logToStorage('ℹ️ Auth state changed - user logged out');
        setCurrentUser(null);
        setUserProfile(null);
      }

      setLoading(false);
    });

    return () => {
      unsubscribed = true;
      unsubscribe();
    };
  }, []);

  const value: AuthContextType = {
    currentUser,
    userProfile,
    loading,
    signInWithGoogle,
    logout,
    error,
    debugLogs,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
