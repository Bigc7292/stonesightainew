import React, { createContext, useContext, useState, useCallback } from 'react';
import { User, AuthState, LoginCredentials, UserRole } from './types';
import { DEMO_USERS } from './users';

interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
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
    isLoading: false,
  });

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { email, password } = credentials;
    const normalizedEmail = email.toLowerCase().trim();

    // Simulate network delay for realism
    await new Promise(resolve => setTimeout(resolve, 800));

    const entry = DEMO_USERS[normalizedEmail];
    if (!entry) {
      return { success: false, error: 'No account found with this email' };
    }
    if (entry.password !== password) {
      return { success: false, error: 'Incorrect password' };
    }

    const user = entry.user;
    setState({ user, isAuthenticated: true, isLoading: false });
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  const hasRole = useCallback(
    (role: UserRole) => {
      if (!state.user) return false;
      const userRole = state.user.role as string;
      if (userRole === 'admin') return true; // admin has all roles
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
