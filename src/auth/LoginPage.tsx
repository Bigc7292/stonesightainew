import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Eye, EyeOff, LogIn, Shield, Code2, User as UserIcon, ChevronDown } from 'lucide-react';
import { useAuth } from './AuthContext';
import { UserRole } from './types';

const QUICK_LOGINS: { label: string; email: string; password: string; role: UserRole; icon: React.ReactNode; color: string }[] = [
  { label: 'Visitor', email: 'visitor@stonesight.ai', password: 'visitor123', role: 'visitor', icon: <UserIcon className="w-4 h-4" />, color: 'text-blue-400' },
  { label: 'Developer', email: 'dev@stonesight.ai', password: 'dev2024', role: 'dev', icon: <Code2 className="w-4 h-4" />, color: 'text-emerald-400' },
  { label: 'Admin', email: 'admin@stonesight.ai', password: 'admin2024', role: 'admin', icon: <Shield className="w-4 h-4" />, color: 'text-amber-400' },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickLogins, setShowQuickLogins] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login({ email, password });
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setIsLoading(false);
  };

  const handleQuickLogin = async (email: string, password: string) => {
    setEmail(email);
    setPassword(password);
    setError('');
    setIsLoading(true);
    const result = await login({ email, password });
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 50% 0%, #1a1a1a 0%, #0a0a0a 100%)' }}>
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full opacity-5" style={{ background: 'radial-gradient(circle, #D4AF37, transparent)' }} />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full opacity-5" style={{ background: 'radial-gradient(circle, #B8975E, transparent)' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-flex items-center gap-3 mb-4"
          >
            <img src="/logo.jpg" alt="StoneSight" className="w-14 h-14 rounded-lg shadow-lg" />
            <div className="text-left">
              <h1 className="text-2xl font-bold tracking-tight text-white font-display">
                St<span className="text-gold-500 relative">o<span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px]">^</span></span>ne<span className="text-gold-500">Sight</span>
              </h1>
              <span className="text-[9px] font-medium text-gray-500 tracking-[0.15em] uppercase">See Your Home, Stone by Stone</span>
            </div>
          </motion.div>
          <p className="text-gray-400 text-sm mt-2">Sign in to your account</p>
        </div>

        {/* Login Card */}
        <div className="glass rounded-2xl p-8 shadow-premium">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@stonesight.ai"
                required
                className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/30 transition-all text-sm"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/30 transition-all text-sm pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-gradient-gold text-dark-900 font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-gray-500 uppercase tracking-wider">Quick Access</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Quick Login Buttons */}
          <div>
            <button
              onClick={() => setShowQuickLogins(!showQuickLogins)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 text-gray-400 hover:border-gold-500/30 hover:text-gray-300 transition-all text-sm"
            >
              <span>Demo Accounts</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showQuickLogins ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showQuickLogins && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 space-y-2 overflow-hidden"
                >
                  {QUICK_LOGINS.map(q => (
                    <button
                      key={q.email}
                      onClick={() => handleQuickLogin(q.email, q.password)}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-white/5 bg-dark-700/50 hover:border-gold-500/20 hover:bg-dark-600/50 transition-all text-sm disabled:opacity-50 group"
                    >
                      <span className={`${q.color} group-hover:scale-110 transition-transform`}>{q.icon}</span>
                      <div className="text-left flex-1">
                        <div className="text-gray-300 font-medium">{q.label}</div>
                        <div className="text-gray-500 text-xs">{q.email}</div>
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border ${
                        q.role === 'admin'
                          ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          : q.role === 'dev'
                          ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                          : 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                      }`}>
                        {q.role}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-6">
          StoneSight AI &middot; Powered by Gemini
        </p>
      </motion.div>
    </div>
  );
}
