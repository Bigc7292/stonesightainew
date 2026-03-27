import { User } from './types';

// Local privileged accounts — checked BEFORE hitting Supabase auth
export const LOCAL_ACCOUNTS: Record<string, { password: string; user: User }> = {
  'dev@stonesight.ai': {
    password: 'StoneSight_Dev_2026!',
    user: {
      id: 'local-dev-001',
      email: 'dev@stonesight.ai',
      name: 'Dev User',
      role: 'dev',
    },
  },
  'admin@stonesight.ai': {
    password: 'StoneSight_Admin_2026!',
    user: {
      id: 'local-admin-001',
      email: 'admin@stonesight.ai',
      name: 'Admin',
      role: 'admin',
    },
  },
};
