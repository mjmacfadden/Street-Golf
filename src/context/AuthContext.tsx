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

// Helper function to detect if app is in standalone/PWA mode
const isStandaloneMode = (): boolean => {
  // Check if running as installed PWA (iOS)
  if (window.navigator.standalone === true) {
    return true;
  }
  // Check if running as installed PWA (Android)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // Check if running as fullscreen (some PWAs use this)
  if (window.matchMedia('(display-mode: fullscreen)').matches) {
    return true;
  }
  return false;
};



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
      const inStandaloneMode = isStandaloneMode();
      logToStorage(`🔐 Starting Google OAuth flow... (PWA standalone: ${inStandaloneMode})`);
      localStorage.setItem('authFlow_started', new Date().toISOString());
      
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account',
      });
      
      if (inStandaloneMode) {
        // Use redirect-based flow for PWA mode (popups blocked in standalone)
        // With authDomain now set to actual domain, this should work properly
        logToStorage('📱 Using redirect flow for PWA mode (authDomain is now first-party)');
        logToStorage('⏳ Redirecting to Google sign-in...');
        localStorage.setItem('authFlow_step', 'redirecting');
        await signInWithRedirect(auth, provider);
        // The redirect will navigate away, so loading will stay true
        // The auth state will update when user returns
        logToStorage('⏳ Redirect initiated, awaiting return...');
      } else {
        // Use popup flow for browser mode (works fine in browser)
        logToStorage('🌐 Using popup flow for browser mode');
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        logToStorage(`✅ OAuth popup completed, user authenticated: ${user.email}`);

        // Create or update user profile in Firestore (non-blocking)
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
          } else {
            logToStorage('✅ User profile already exists');
          }
        } catch (firestoreErr) {
          logToStorage(`⚠️ Non-critical error creating user profile in Firestore: ${firestoreErr}`);
        }
        
        logToStorage('⏳ Waiting for auth state update...');
      }
    } catch (err: any) {
      // Handle auth errors (both popup and redirect)
      logToStorage(`❌ Google Sign-In Error: ${err?.code} - ${err?.message}`);
      
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled');
        logToStorage('User closed the OAuth popup');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Pop-up blocked by browser. Please check your browser settings.');
        logToStorage('Browser blocked the OAuth popup');
      } else if (err?.code === 'auth/cancelled-popup-request') {
        setError('Sign-in cancelled');
        logToStorage('Popup request was cancelled');
      } else if (err?.code === 'auth/redirect-cancelled-by-user') {
        setError('Sign-in cancelled');
        logToStorage('User cancelled the OAuth redirect');
      } else {
        const message = err?.message || 'Failed to sign in with Google';
        setError(message);
        logToStorage(`Unexpected OAuth error: ${message}`);
      }
      
      // Only set loading to false for actual auth errors
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

  // Handle OAuth redirect result on app init (for PWA redirect flow)
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        logToStorage('🔄 Checking for OAuth redirect result...');
        const result = await getRedirectResult(auth);
        
        if (result?.user) {
          logToStorage(`✅ OAuth redirect completed, user authenticated: ${result.user.email}`);
          
          // Create or update user profile in Firestore
          try {
            const userRef = doc(db, 'users', result.user.uid);
            const userDoc = await getDoc(userRef);

            if (!userDoc.exists()) {
              await setDoc(userRef, {
                uid: result.user.uid,
                email: result.user.email,
                displayName: result.user.displayName,
                photoURL: result.user.photoURL,
                createdAt: new Date().toISOString(),
              });
              logToStorage('✅ User profile created in Firestore (from redirect)');
            } else {
              logToStorage('✅ User profile already exists in Firestore');
            }
          } catch (firestoreErr) {
            logToStorage(`⚠️ Non-critical error creating user profile in Firestore: ${firestoreErr}`);
          }
        } else {
          logToStorage('ℹ️ No redirect result found (this is normal for popup flow or first load)');
        }
      } catch (err: any) {
        if (err?.code === 'auth/redirect-cancelled-by-user') {
          logToStorage('ℹ️ User cancelled OAuth redirect');
        } else if (!err?.code?.includes('redirect-operation-pending')) {
          logToStorage(`⚠️ Error checking redirect result: ${err?.code} - ${err?.message}`);
        }
      }
    };

    handleRedirectResult();
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
