import { User } from './types';

// Hardcoded user accounts for demo purposes
// In production, these would come from Supabase or another auth provider
export const DEMO_USERS: Record<string, { password: string; user: User }> = {
  // Dev accounts
  'dev@stonesight.ai': {
    password: 'dev2024',
    user: {
      id: 'dev-001',
      email: 'dev@stonesight.ai',
      name: 'Dev User',
      role: 'dev',
    },
  },
  'developer@stonesight.ai': {
    password: 'devpass',
    user: {
      id: 'dev-002',
      email: 'developer@stonesight.ai',
      name: 'Developer',
      role: 'dev',
    },
  },
  // Admin accounts
  'admin@stonesight.ai': {
    password: 'admin2024',
    user: {
      id: 'admin-001',
      email: 'admin@stonesight.ai',
      name: 'Admin',
      role: 'admin',
    },
  },
  'superadmin@stonesight.ai': {
    password: 'superadmin',
    user: {
      id: 'admin-002',
      email: 'superadmin@stonesight.ai',
      name: 'Super Admin',
      role: 'admin',
    },
  },
  // Visitor / regular user accounts
  'visitor@stonesight.ai': {
    password: 'visitor123',
    user: {
      id: 'visitor-001',
      email: 'visitor@stonesight.ai',
      name: 'Visitor',
      role: 'visitor',
    },
  },
  'demo@stonesight.ai': {
    password: 'demo123',
    user: {
      id: 'visitor-002',
      email: 'demo@stonesight.ai',
      name: 'Demo User',
      role: 'visitor',
    },
  },
};
