import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
} from '../config/firebase';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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
// Only logs errors and critical steps, not verbose details
const logToStorage = (message: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[${timestamp}] ${message}`;
  console.log(fullMessage);
  
  // Only store errors and critical messages in localStorage for mobile debugging
  const isImportant = message.includes('❌') || message.includes('✅') || message.includes('🔐') || message.includes('Error');
  if (!isImportant) return; // Skip verbose logs
  
  try {
    let logs = JSON.parse(localStorage.getItem('authDebugLogs') || '[]') as string[];
    logs.push(fullMessage);
    // Keep last 50 logs
    if (logs.length > 50) logs = logs.slice(-50);
    localStorage.setItem('authDebugLogs', JSON.stringify(logs));
  } catch (e) {
    // Ignore localStorage errors
  }
};

// ---------------------------------------------------------------------------
// Auth helpers
//
// signInWithPopup  → browser mode only; popup opens as child window, postMessage works fine.
// signInWithRedirect → standalone PWA mode. Firebase redirects within the same WKWebView
//                      context; the auth handler lives on street-golf-69679.web.app (same
//                      eTLD+1 as the app), so ITP never blocks the cross-origin iframe.
//                      getRedirectResult() is called on every page load to pick up the result.
// ---------------------------------------------------------------------------



export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const signInWithGoogle = async () => {
    try {
      setError(null);
      setLoading(true);
      const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
      logToStorage(`🔐 Starting Google sign-in (standalone: ${isStandalone}, authDomain: ${import.meta.env.VITE_FIREBASE_AUTH_DOMAIN})`);

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      if (isStandalone) {
        // Redirect navigates the WKWebView to Firebase's auth handler on the same
        // web.app domain, then back — no popup, no cross-origin iframe, no ITP issue.
        logToStorage('📲 Standalone: redirecting to Google sign-in...');
        await signInWithRedirect(auth, provider);
        // Page navigates away — nothing below this line runs.
        return;
      }

      // Browser: popup communicates via postMessage — works fine
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      logToStorage(`✅ Signed in: ${user.email}`);

      // Create user profile in Firestore if it doesn't exist (non-blocking)
      try {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: new Date().toISOString(),
          });
          logToStorage('✅ User profile created in Firestore');
        }
      } catch (firestoreErr) {
        logToStorage(`⚠️ Non-critical Firestore error: ${firestoreErr}`);
      }
    } catch (err: any) {
      logToStorage(`❌ Sign-in error: ${err?.code} - ${err?.message}`);

      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setError('Sign-in cancelled.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('OPEN_IN_BROWSER');

      } else {
        setError(err?.message || 'Failed to sign in with Google.');
      }

      setLoading(false);
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

  // On mount: pick up the result of a signInWithRedirect if one is pending.
  // This fires on every page load but resolves immediately (null) when there's no redirect.
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (!result) return; // Normal page load — no pending redirect
        logToStorage(`✅ Redirect sign-in complete: ${result.user.email}`);
        // onAuthStateChanged fires automatically; create Firestore profile if needed.
        const user = result.user;
        const userRef = doc(db, 'users', user.uid);
        getDoc(userRef)
          .then((snap) => {
            if (!snap.exists()) {
              return setDoc(userRef, {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                createdAt: new Date().toISOString(),
              });
            }
          })
          .catch((err) => logToStorage(`⚠️ Non-critical Firestore error: ${err}`));
      })
      .catch((err) => {
        logToStorage(`❌ Redirect sign-in error: ${err?.message}`);
        setError(err?.message || 'Sign-in failed. Please try again.');
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync debug logs from localStorage periodically
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

  // Listen to auth state changes - this is the source of truth for login state
  useEffect(() => {
    logToStorage('🔐 Setting up auth state listener...');
    let authStateCheckCount = 0;
    let timeoutId: NodeJS.Timeout | null = null;
    let unsubscribed = false;
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (unsubscribed) return;

      // Clear any pending timeout since we got a response
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      authStateCheckCount++;
      const userStatus = user ? `Logged in as ${user.email}` : 'Not logged in';
      logToStorage(`📍 Auth state check #${authStateCheckCount}: ${userStatus}`);
      localStorage.setItem('authFlow_step', `auth_state_check_${authStateCheckCount}`);
      
      try {
        if (user) {
          logToStorage(`✅ Auth state changed - user logged in: ${user.email}`);
          logToStorage(`📝 User info: uid=${user.uid}, email=${user.email}, displayName=${user.displayName}, emailVerified=${user.emailVerified}, isAnonymous=${user.isAnonymous}`);
          setCurrentUser(user);
          
          // Fetch user profile from Firestore
          try {
            const userRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
              setUserProfile(userDoc.data() as UserProfile);
              logToStorage('✅ User profile loaded from Firestore');
            } else {
              logToStorage('ℹ️ User profile not found in Firestore, will be created on first action');
            }
          } catch (err) {
            logToStorage(`❌ Error fetching user profile: ${err}`);
          }
        } else {
          logToStorage('✅ Auth state changed - user logged out or not authenticated');
          setCurrentUser(null);
          setUserProfile(null);
        }
      } catch (err) {
        logToStorage(`❌ Error in auth state change handler: ${err}`);
      } finally {
        // Always set loading to false when auth state is determined
        logToStorage('✅ Auth state check complete, setting loading to false');
        localStorage.setItem('authFlow_step', 'auth_state_resolved');
        setLoading(false);
        setAuthInitialized(true);
      }
    });

    // Safety timeout: If auth state hasn't resolved in 5 seconds, force it
    timeoutId = setTimeout(() => {
      logToStorage('⚠️ Auth state check timeout after 5 seconds, forcing loading to false');
      localStorage.setItem('authFlow_step', 'auth_state_timeout');
      setLoading(false);
      setAuthInitialized(true);
    }, 5000);

    return () => {
      logToStorage('🔐 Cleaning up auth state listener');
      unsubscribed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
