import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  User,
  AuthState,
  LoginCredentials,
  SignupCredentials,
  UserRole,
  Generation,
} from "./types";
import {
  signIn as supabaseSignIn,
  signUp as supabaseSignUp,
  signOut as supabaseSignOut,
  getOrCreateProfile,
  onAuthStateChange,
} from "../services/supabaseAuth";
import { getUserGenerations } from "../services/generationService";
import { supabase } from "../lib/supabase";

interface AuthContextType extends AuthState {
  login: (
    credentials: LoginCredentials,
  ) => Promise<{ success: boolean; error?: string }>;
  signup: (
    credentials: SignupCredentials,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasRole: (role: UserRole) => boolean;
  isAdmin: boolean;
  generations: Generation[];
  accessToken?: string | null;
  setGenerations: (gens: Generation[]) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    generations: [],
    accessToken: null,
  });

  // Initialize auth state
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        initializeAuthSession(session);
      } else {
        setState((prev) => ({ ...prev, isLoading: false, accessToken: null }));
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await initializeAuthSession(session);
      } else {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          generations: [],
          accessToken: null,
        }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Helper function to initialize auth session
  const initializeAuthSession = async (session: any) => {
    try {
      const meta = session.user.user_metadata;
      const profileResult = await getOrCreateProfile(
        session.user.id,
        meta?.full_name || session.user.email || "User",
        "user",
      );
      const role = (profileResult.data?.role as UserRole) || "user";

      setState((prev) => ({
        ...prev,
        user: {
          id: session.user.id,
          email: session.user.email || "",
          name: meta?.full_name || session.user.email || "User",
          role,
        },
        isAuthenticated: true,
        isLoading: false,
        accessToken: session.access_token,
      }));

      // Load user generations when authenticated
      if (session.user.id) {
        getUserGenerations(session.user.id).then(({ data, error }) => {
          if (!error && data) {
            setState((prev) => ({ ...prev, generations: data }));
          }
        });
      }
    } catch (error) {
      console.error("Error initializing auth session:", error);
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { email, password } = credentials;
    const normalizedEmail = email.toLowerCase().trim();

    // Supabase Auth only
    const { data, error } = await supabaseSignIn(normalizedEmail, password);
    if (error) {
      return { success: false, error: error.message };
    }

    const supaUser = data.user;
    if (!supaUser) {
      return { success: false, error: "Login failed" };
    }

    // Enforce email verification
    if (!supaUser.email_confirmed_at) {
      await supabaseSignOut();
      return {
        success: false,
        error:
          "Please verify your email first. Check your inbox for a confirmation link.",
      };
    }

    const meta = supaUser.user_metadata;
    const profileResult = await getOrCreateProfile(
      supaUser.id,
      meta?.full_name || supaUser.email || "User",
      "user",
    );
    const role = (profileResult.data?.role as UserRole) || "user";

    setState((prev) => ({
      ...prev,
      user: {
        id: supaUser.id,
        email: supaUser.email || "",
        name: meta?.full_name || supaUser.email || "User",
        role,
      },
      isAuthenticated: true,
      isLoading: false,
      accessToken: data.session?.access_token || null,
    }));

    return { success: true };
  }, []);

  const signup = useCallback(async (credentials: SignupCredentials) => {
    const { email, password, name } = credentials;
    const normalizedEmail = email.toLowerCase().trim();

    const { error } = await supabaseSignUp(normalizedEmail, password, name);
    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  }, []);

  const logout = useCallback(async () => {
    await supabaseSignOut();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      generations: [],
      accessToken: null,
    });
  }, []);

  const hasRole = useCallback(
    (role: UserRole) => {
      if (!state.user) return false;
      const userRole = state.user.role as UserRole;
      if ((userRole as UserRole) === ("admin" as UserRole)) return true;
      if ((role as UserRole) === ("dev" as UserRole))
        return (
          userRole === ("dev" as UserRole) || userRole === ("admin" as UserRole)
        );
      return userRole === role;
    },
    [state.user],
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        signup,
        logout,
        hasRole,
        isAdmin: (state.user?.role as UserRole) === ("admin" as UserRole),
        generations: state.generations,
        accessToken: state.accessToken,
        setGenerations: (gens) =>
          setState((prev) => ({ ...prev, generations: gens })),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
