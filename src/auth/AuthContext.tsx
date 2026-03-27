import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, AuthState, LoginCredentials, SignupCredentials, UserRole } from './types';
import { LOCAL_ACCOUNTS } from './users';
import { signIn as supabaseSignIn, signUp as supabaseSignUp, signOut as supabaseSignOut, getOrCreateProfile, onAuthStateChange } from '../services/supabaseAuth';

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  signup: (credentials: SignupCredentials) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasRole: (role: UserRole) => boolean;
  isAdmin: boolean;
  isDev: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
  const [isLocalSession, setIsLocalSession] = useState(false);

  // On mount, check for existing Supabase session
  useEffect(() => {
    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      if (session?.user && !isLocalSession) {
        const meta = session.user.user_metadata;
        const profileResult = await getOrCreateProfile(
          session.user.id,
          meta?.full_name || session.user.email || 'User',
          'user'
        );
        const role = (profileResult.data?.role as UserRole) || 'user';

        setState({
          user: {
            id: session.user.id,
            email: session.user.email || '',
            name: meta?.full_name || session.user.email || 'User',
            role,
          },
          isAuthenticated: true,
          isLoading: false,
        });
      } else if (!isLocalSession) {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, [isLocalSession]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { email, password } = credentials;
    const normalizedEmail = email.toLowerCase().trim();

    // Check local privileged accounts FIRST
    const localEntry = LOCAL_ACCOUNTS[normalizedEmail];
    if (localEntry) {
      if (localEntry.password !== password) {
        return { success: false, error: 'Incorrect password' };
      }
      setIsLocalSession(true);
      setState({ user: localEntry.user, isAuthenticated: true, isLoading: false });
      return { success: true };
    }

    // Fall back to Supabase Auth
    const { data, error } = await supabaseSignIn(normalizedEmail, password);
    if (error) {
      return { success: false, error: error.message };
    }

    const supaUser = data.user;
    if (!supaUser) {
      return { success: false, error: 'Login failed' };
    }

    // Enforce email verification
    if (!supaUser.email_confirmed_at) {
      await supabaseSignOut();
      return { success: false, error: 'Please verify your email first. Check your inbox for a confirmation link.' };
    }

    const meta = supaUser.user_metadata;
    const profileResult = await getOrCreateProfile(
      supaUser.id,
      meta?.full_name || supaUser.email || 'User',
      'user'
    );
    const role = (profileResult.data?.role as UserRole) || 'user';

    setState({
      user: {
        id: supaUser.id,
        email: supaUser.email || '',
        name: meta?.full_name || supaUser.email || 'User',
        role,
      },
      isAuthenticated: true,
      isLoading: false,
    });

    return { success: true };
  }, []);

  const signup = useCallback(async (credentials: SignupCredentials) => {
    const { email, password, name } = credentials;
    const normalizedEmail = email.toLowerCase().trim();

    // Don't allow signup with local account emails
    if (LOCAL_ACCOUNTS[normalizedEmail]) {
      return { success: false, error: 'This email is reserved. Please use a different email.' };
    }

    const { error } = await supabaseSignUp(normalizedEmail, password, name);
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    if (!isLocalSession) {
      await supabaseSignOut();
    }
    setIsLocalSession(false);
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, [isLocalSession]);

  const hasRole = useCallback(
    (role: UserRole) => {
      if (!state.user) return false;
      const userRole = state.user.role;
      if (userRole === 'admin') return true;
      if (role === 'dev') return userRole === 'dev' || userRole === 'admin';
      return userRole === role;
    },
    [state.user]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        logout,
        hasRole,
        isAdmin: state.user?.role === 'admin',
        isDev: state.user?.role === 'dev' || state.user?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
