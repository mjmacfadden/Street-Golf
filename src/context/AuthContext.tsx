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
const logToStorage = (message: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const fullMessage = `[${timestamp}] ${message}`;
  console.log(fullMessage);
  
  // Also store in localStorage for mobile debugging
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
        // Use redirect-based flow for PWA mode (no popups)
        logToStorage('📱 Using redirect flow for PWA mode');
        logToStorage('⏳ Redirecting to Google sign-in...');
        localStorage.setItem('authFlow_step', 'redirecting');
        await signInWithRedirect(auth, provider);
        // The redirect will navigate away, so loading will stay true
        // The auth state will update when user returns
        logToStorage('⏳ Redirect initiated, awaiting return...');
      } else {
        // Use popup flow for browser mode
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
      // Only handle actual auth errors here
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

  // Handle OAuth redirect result on app init
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        // Check if redirect script ran and log its status
        try {
          const redirectDebug = JSON.parse(localStorage.getItem('redirectScriptDebug') || '{}');
          const redirectAction = localStorage.getItem('redirectScriptAction');
          logToStorage(`🔀 Redirect script info: ${JSON.stringify({
            action: redirectAction,
            rootPathname: redirectDebug.pathname,
            rootSearch: redirectDebug.search,
          })}`);
        } catch (e) {
          logToStorage('🔀 No redirect script debug info found');
        }
        
        logToStorage('🔄 Checking for OAuth redirect result...');
        localStorage.setItem('authFlow_step', 'checking_redirect');
        
        // Log current URL and origin for debugging
        logToStorage(`📍 Current URL: ${window.location.href}`);
        logToStorage(`📍 Origin: ${window.location.origin}`);
        logToStorage(`📍 Pathname: ${window.location.pathname}`);
        logToStorage(`📍 Search params: ${window.location.search || '(none)'}`);
        
        // Give Firebase a moment to process the redirect before calling getRedirectResult
        // This is important after a redirect from Google
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const result = await getRedirectResult(auth);
        
        // Log the full result object to understand what's happening
        logToStorage(`📦 getRedirectResult returned: ${JSON.stringify({
          hasUser: !!result?.user,
          hasCredential: !!result?.credential,
          operationType: result?.operationType,
          userEmail: result?.user?.email || 'none',
        })}`);
        
        if (result?.user) {
          logToStorage(`✅ OAuth redirect completed, user authenticated: ${result.user.email}`);
          localStorage.setItem('authFlow_step', 'redirect_completed');
          logToStorage(`📝 User details: ${JSON.stringify({
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName,
          })}`);
          
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
          
          // Auth state will update automatically via onAuthStateChanged
          logToStorage('⏳ Redirect result processed, waiting for auth state listener...');
        } else {
          logToStorage(`⚠️ getRedirectResult returned null/empty.`);
          logToStorage(`💡 If you see search params above but still get null: Update authorized redirect URIs in both Firebase AND Google Cloud Console to use your app URL (https://mjmacfadden.github.io/street-golf/) instead of /__/auth/handler`);
          
          // Check localStorage to see if anything is stored
          try {
            const keys = Object.keys(localStorage);
            const firebaseKeys = keys.filter(k => k.includes('firebase') || k.includes('auth'));
            if (firebaseKeys.length > 0) {
              logToStorage(`💾 Found ${firebaseKeys.length} Firebase storage keys`);
            } else {
              logToStorage(`⚠️ No Firebase storage keys found - session may not be persisting`);
            }
          } catch (e) {
            logToStorage(`⚠️ Could not check localStorage: ${e}`);
          }
        }
      } catch (err: any) {
        // Check if this is an auth/redirect-operation-pending-for-user error
        // This is normal when the redirect hasn't completed yet
        if (err?.code === 'auth/redirect-cancelled-by-user') {
          logToStorage('ℹ️ User cancelled OAuth redirect');
          setError('Sign-in cancelled');
          setLoading(false);
        } else if (err?.code?.includes('redirect-operation-pending')) {
          logToStorage('ℹ️ Redirect operation pending...');
        } else {
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
