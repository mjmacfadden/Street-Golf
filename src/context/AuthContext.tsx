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
// Auth architecture: Custom OAuth handler with window.open + postMessage
//
// Browser mode: PWA opens custom handler at https://street-golf-69679.firebaseapp.com/auth-handler.html
//               Handler does signInWithPopup to Google, receives idToken, posts back via postMessage.
// Standalone mode: Same flow — doesn't break out of the PWA context because handler is a separate
//                  window, not a popup within the app. iOS/Android stays in PWA while handler
//                  window manages the OAuth dance with Google.
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
      logToStorage('🔐 Starting Google sign-in (opening auth handler)...');

      // Open the custom auth handler page in a separate window
      const authWindow = window.open(
        'https://street-golf-69679.firebaseapp.com/auth-handler.html',
        'auth-handler',
        'width=500,height=600'
      );

      if (!authWindow) {
        setError('Popup was blocked. Please check your browser settings.');
        setLoading(false);
        return;
      }

      // Listen for the idToken coming back from the auth handler
      const messageHandler = async (event: MessageEvent) => {
        // Only trust messages from our Firebase Hosting domain
        if (event.origin !== 'https://street-golf-69679.firebaseapp.com') return;

        if (event.data?.type === 'AUTH_SUCCESS' && event.data?.idToken) {
          logToStorage('🔐 Received auth token from handler');
          try {
            // Sign in to Firebase using the idToken
            const credential = GoogleAuthProvider.credential(event.data.idToken);
            const result = await signInWithCredential(auth, credential);
            const user = result.user;
            logToStorage(`✅ Signed in: ${user.email}`);

            // Create user profile in Firestore if it doesn't exist
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

            // Clean up
            window.removeEventListener('message', messageHandler);
            authWindow.close();
          } catch (signInErr: any) {
            logToStorage(`❌ Sign-in error: ${signInErr?.message}`);
            setError(signInErr?.message || 'Failed to sign in.');
            setLoading(false);
            window.removeEventListener('message', messageHandler);
          }
        } else if (event.data?.type === 'AUTH_ERROR') {
          logToStorage(`❌ Handler error: ${event.data?.error}`);
          setError(event.data?.error || 'Authentication failed.');
          setLoading(false);
          window.removeEventListener('message', messageHandler);
          authWindow.close();
        }
      };

      window.addEventListener('message', messageHandler);

      // Timeout after 5 minutes
      const timeoutId = setTimeout(() => {
        logToStorage('⚠️ Auth handler timeout after 5 minutes');
        window.removeEventListener('message', messageHandler);
        authWindow.close();
        setError('Sign-in timed out. Please try again.');
        setLoading(false);
      }, 5 * 60 * 1000);

      // Cleanup if window is closed by user
      const checkWindowClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkWindowClosed);
          clearTimeout(timeoutId);
          window.removeEventListener('message', messageHandler);
          logToStorage('ℹ️ Auth handler window closed by user');
          // Only set error if we're still loading (user didn't complete auth)
          if (loading) {
            setError('Sign-in cancelled.');
            setLoading(false);
          }
        }
      }, 500);
    } catch (err: any) {
      logToStorage(`❌ Sign-in error: ${err?.message}`);
      setError(err?.message || 'Failed to sign in with Google.');
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
