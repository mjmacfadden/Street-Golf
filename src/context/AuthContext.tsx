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
// PKCE OAuth helpers — bypass Firebase's cross-origin iframe mechanism
// (which Apple ITP blocks in PWA standalone mode on GitHub Pages hosting)
// ---------------------------------------------------------------------------

function pkceVerifier(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Firebase exposes the Google OAuth client ID via its Identity Toolkit endpoint.
async function fetchGoogleClientId(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${import.meta.env.VITE_FIREBASE_API_KEY}`
    );
    const cfg = await res.json();
    const google = (cfg.idpConfig as Array<{ provider: string; clientId?: string }> | undefined)
      ?.find(p => p.provider === 'GOOGLE');
    return google?.clientId ?? null;
  } catch {
    return null;
  }
}

async function startPKCESignIn(): Promise<void> {
  const clientId = await fetchGoogleClientId();
  if (!clientId) throw new Error('Could not fetch Google OAuth client ID from Firebase config');

  const verifier = pkceVerifier();
  const challenge = await pkceChallenge(verifier);
  const state = pkceVerifier(); // random CSRF nonce

  // Use localStorage — sessionStorage can be cleared by WebKit on full-page navigations
  localStorage.setItem('pkce_verifier', verifier);
  localStorage.setItem('pkce_state', state);

  // Redirect URI must be registered in Google Cloud Console:
  // APIs & Services → Credentials → Web client (auto created by Google Service)
  // → Authorized redirect URIs → add https://mjmacfadden.github.io/street-golf/
  const redirectUri = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '') + '/';

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');

  window.location.href = url.toString();
}

async function completePKCESignIn(code: string, state: string): Promise<void> {
  const savedState = localStorage.getItem('pkce_state');
  const verifier = localStorage.getItem('pkce_verifier');

  localStorage.removeItem('pkce_state');
  localStorage.removeItem('pkce_verifier');

  if (state !== savedState) throw new Error('OAuth state mismatch — possible CSRF');
  if (!verifier) throw new Error('PKCE verifier missing');

  const clientId = await fetchGoogleClientId();
  if (!clientId) throw new Error('Could not fetch Google OAuth client ID');

  const redirectUri = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '') + '/';

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error_description?: string; error?: string };
    throw new Error(err.error_description || err.error || `Token exchange failed (${res.status})`);
  }

  const tokens = await res.json() as { id_token: string; access_token: string };
  const credential = GoogleAuthProvider.credential(tokens.id_token, tokens.access_token);
  await signInWithCredential(auth, credential);
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
        // signInWithPopup: window.open() in iOS standalone spawns a separate Safari process
        //   — postMessage can't reach back to the WebView.
        // signInWithRedirect: navigates the WebView through OAuth, but Apple ITP blocks
        //   Firebase's cross-origin iframe that reads the result back (different eTLD+1).
        // PKCE: navigates the WebView to Google directly, exchanges the code client-side
        //   via a plain HTTPS fetch — no cross-origin iframes, ITP-proof.
        logToStorage('📲 Standalone: starting PKCE OAuth flow');
        await startPKCESignIn(); // navigates away — nothing runs after this
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
        setError('Popup was blocked. Try again or use the button in your browser settings.');
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

  // Handle PKCE OAuth callback (?code=...&state=...) on page load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const hasVerifier = !!localStorage.getItem('pkce_verifier');

    if (!code || !state || !hasVerifier) return;

    // Clean the URL immediately so Back/Refresh don't re-trigger
    history.replaceState({}, '', window.location.pathname);

    logToStorage('🔐 PKCE callback received — exchanging code for token...');
    setLoading(true);
    setError(null);

    completePKCESignIn(code, state)
      .then(() => {
        logToStorage('✅ PKCE sign-in complete — waiting for onAuthStateChanged');
        // onAuthStateChanged will update currentUser and setLoading(false)
      })
      .catch((err: Error) => {
        logToStorage(`❌ PKCE error: ${err.message}`);
        setError(err.message || 'Sign-in failed. Please try again.');
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
