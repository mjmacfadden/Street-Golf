import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  db,
} from '../config/firebase';
import {
  signInWithPopup,
  signInWithCredential,
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
// Google One Tap / FedCM — standalone PWA sign-in
//
// signInWithPopup → window.open() opens Safari (different OS process); postMessage
//                   can't reach back to the standalone WebView.
// signInWithRedirect → Apple ITP blocks the cross-origin iframe Firebase uses to
//                      read the result back (app on github.io ≠ auth on firebaseapp.com).
// PKCE → Google requires client_secret for Web Application clients even with PKCE
//         (it's a server-side-only mechanism; we can't expose the secret client-side).
// One Tap / FedCM → browser-native credential selector, no popup/redirect/iframe.
//                   Supported on iOS 17+ WebKit (WKWebView). Returns id_token directly.
// ---------------------------------------------------------------------------

// Google OAuth client ID — public identifier, safe to hardcode in client code.
const GOOGLE_OAUTH_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) ||
  '11862667875-ai1fo9pnp7ifovic9b9pp2gig99b1ogj.apps.googleusercontent.com';

type GISCredentialResponse = { credential: string; select_by: string };
type GISPromptNotification = {
  isDisplayMoment(): boolean;
  isDisplayed(): boolean;
  isNotDisplayed(): boolean;
  getNotDisplayedReason(): string;
  isSkippedMoment(): boolean;
  getSkippedReason(): string;
  isDismissedMoment(): boolean;
  getDismissedReason(): string;
};
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(cfg: {
            client_id: string;
            callback(r: GISCredentialResponse): void;
            use_fedcm_for_prompt?: boolean;
            itp_support?: boolean;
            cancel_on_tap_outside?: boolean;
          }): void;
          prompt(cb?: (n: GISPromptNotification) => void): void;
          cancel(): void;
        };
      };
    };
  }
}

function loadGIS(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
}

function googleOneTap(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: typeof resolve | typeof reject, v: Parameters<typeof resolve>[0] | Parameters<typeof reject>[0]) => {
      if (done) return;
      done = true;
      (fn as (v: unknown) => void)(v);
    };

    window.google!.accounts.id.initialize({
      client_id: clientId,
      callback: (r: GISCredentialResponse) => finish(resolve, r.credential),
      use_fedcm_for_prompt: true,
      itp_support: true,
      cancel_on_tap_outside: false,
    });

    window.google!.accounts.id.prompt((n: GISPromptNotification) => {
      if (n.isNotDisplayed()) {
        finish(reject, new Error(`One Tap not shown: ${n.getNotDisplayedReason()}`));
      } else if (n.isSkippedMoment()) {
        finish(reject, new Error(`One Tap skipped: ${n.getSkippedReason()}`));
      }
    });

    // Safety timeout
    setTimeout(() => finish(reject, new Error('One Tap timed out after 30s')), 30000);
  });
}



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
        logToStorage('📲 Standalone: trying Google One Tap (FedCM)');
        await loadGIS();
        const idToken = await googleOneTap(GOOGLE_OAUTH_CLIENT_ID);
        const credential = GoogleAuthProvider.credential(idToken);
        const result = await signInWithCredential(auth, credential);
        const user = result.user;
        logToStorage(`✅ One Tap sign-in: ${user.email}`);

        // Create Firestore profile if needed
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
          }
        } catch (firestoreErr) {
          logToStorage(`⚠️ Non-critical Firestore error: ${firestoreErr}`);
        }
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
      } else if (err?.message?.includes('One Tap') || err?.message?.includes('not shown') || err?.message?.includes('skipped')) {
        // One Tap unavailable (older iOS, user dismissed, or FedCM not supported)
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
