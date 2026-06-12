export type UserRole = "user" | "dev" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  generations: Generation[];
  accessToken?: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  email: string;
  password: string;
  name: string;
}

export interface Generation {
  id: string;
  user_id: string;
  generation_type: "image" | "video";
  input_prompt?: string;
  input_image_url?: string;
  input_parameters?: Record<string, unknown>;
  output_url: string;
  output_metadata?: Record<string, unknown>;
  processing_time_ms?: number;
  model_used?: string;
  tags?: string[];
  created_at: string;
}
