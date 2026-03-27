import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Eye, EyeOff, LogIn, UserPlus, Mail, CheckCircle2 } from 'lucide-react';
import { useAuth } from './AuthContext';

type Mode = 'login' | 'signup';

export function LoginPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
    setError('');
  };

  const switchMode = (newMode: Mode) => {
    resetForm();
    setSignupSuccess(false);
    setMode(newMode);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login({ email, password });
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setIsLoading(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!fullName.trim()) {
      setError('Full name is required');
      return;
    }

    setIsLoading(true);
    const result = await signup({ email, password, name: fullName.trim() });
    if (!result.success) {
      setError(result.error || 'Signup failed');
    } else {
      setSignupSuccess(true);
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
              <span className="text-[9px] font-medium text-gray-500 tracking-[0.15em] uppercase">Premier Architectural Visualization Suite</span>
            </div>
          </motion.div>
          <p className="text-gray-400 text-sm mt-2">
            {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
          </p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8 shadow-premium">
          <AnimatePresence mode="wait">
            {/* Signup Success Screen */}
            {signupSuccess ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="text-center py-6"
              >
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <Mail className="w-8 h-8 text-emerald-400" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">Check Your Email</h3>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  We've sent a verification link to <strong className="text-gray-300">{email}</strong>. Please verify your email before signing in.
                </p>
                <button
                  onClick={() => switchMode('login')}
                  className="w-full py-3 rounded-lg bg-gradient-gold text-dark-900 font-semibold text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  Back to Sign In
                </button>
              </motion.div>
            ) : mode === 'login' ? (
              /* Login Form */
              <motion.form
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
                onSubmit={handleLogin}
                className="space-y-5"
              >
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

                {/* Toggle to Signup */}
                <p className="text-center text-sm text-gray-500 pt-2">
                  Don't have an account?{' '}
                  <button type="button" onClick={() => switchMode('signup')} className="text-gold-400 hover:text-gold-300 font-medium transition-colors">
                    Sign up
                  </button>
                </p>
              </motion.form>
            ) : (
              /* Signup Form */
              <motion.form
                key="signup"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                onSubmit={handleSignup}
                className="space-y-5"
              >
                {/* Full Name */}
                <div>
                  <label htmlFor="fullName" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Stone Artist"
                    required
                    className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/30 transition-all text-sm"
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="signupEmail" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Email
                  </label>
                  <input
                    id="signupEmail"
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
                  <label htmlFor="signupPassword" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="signupPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
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

                {/* Confirm Password */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    required
                    className="w-full px-4 py-3 rounded-lg bg-dark-700 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/30 transition-all text-sm"
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
                  )}
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
                      <UserPlus className="w-4 h-4" />
                      Sign Up
                    </>
                  )}
                </button>

                {/* Toggle to Login */}
                <p className="text-center text-sm text-gray-500 pt-2">
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('login')} className="text-gold-400 hover:text-gold-300 font-medium transition-colors">
                    Log in
                  </button>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-6">
          StoneSight AI &middot; Advanced Architectural Intelligence
        </p>
      </motion.div>
    </div>
  );
}
