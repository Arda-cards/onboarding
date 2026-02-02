import { useState, useEffect } from 'react';
import { Icons } from '../components/Icons';
import { API_BASE_URL } from '../services/api';

// Snarky lean manufacturing quotes for loading states
const LEAN_QUOTES = [
  { quote: "Inventory is the root of all evil.", author: "Taiichi Ohno" },
  { quote: "The most dangerous kind of waste is the waste we do not recognize.", author: "Shigeo Shingo" },
  { quote: "Where there is no standard, there can be no kaizen.", author: "Taiichi Ohno" },
  { quote: "All we are doing is looking at the timeline from order to cash and reducing it.", author: "Taiichi Ohno" },
  { quote: "Having no problems is the biggest problem of all.", author: "Taiichi Ohno" },
  { quote: "Costs do not exist to be calculated. Costs exist to be reduced.", author: "Taiichi Ohno" },
  { quote: "The Toyota style is not to create results by working hard. It is a system that says there is no limit to people's creativity.", author: "Taiichi Ohno" },
  { quote: "Progress cannot be generated when we are satisfied with existing situations.", author: "Taiichi Ohno" },
  { quote: "Without standards, there can be no improvement.", author: "Taiichi Ohno" },
  { quote: "Make your workplace into a showcase that can be understood by everyone at a glance.", author: "Taiichi Ohno" },
  { quote: "If you're going to do kaizen continuously, you've got to assume that things are a mess.", author: "Masaaki Imai" },
  { quote: "The key to the Toyota Way is not any of the individual elements... It is having all the elements together as a system.", author: "Jeffrey Liker" },
  { quote: "Build a culture of stopping to fix problems, to get quality right the first time.", author: "Toyota Principle" },
  { quote: "Waste is any human activity which absorbs resources but creates no value.", author: "James Womack" },
  { quote: "Your customers do not care about your systems, they care about their problems.", author: "Lean Wisdom" },
];

function useRotatingQuote(intervalMs = 4000) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LEAN_QUOTES.length));
  
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % LEAN_QUOTES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  
  return LEAN_QUOTES[index];
}

interface LoginScreenProps {
  onCheckingAuth?: boolean;
  authError?: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onCheckingAuth, authError }) => {
  const quote = useRotatingQuote();
  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  return (
    <div className="relative min-h-screen arda-mesh flex items-center justify-center p-6">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 left-6 w-48 h-48 rounded-full bg-orange-400/15 blur-3xl animate-float" />
        <div className="absolute bottom-0 right-12 w-64 h-64 rounded-full bg-blue-500/15 blur-3xl animate-float" />
      </div>

      <div className="relative z-10 w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Left: brand story */}
        <div className="space-y-6">
          <div className="arda-pill w-fit">
            <Icons.Link className="w-4 h-4" />
            Arda Order Intelligence
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-arda-text-primary leading-tight">
            The easiest way to never run out.
          </h1>
          <p className="text-arda-text-secondary text-lg max-w-xl">
            Connect your email and let Arda's AI automatically discover your suppliers,
            track order velocity, and surface replenishment signals before stockouts happen.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-arda-text-secondary">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.ShieldCheck className="w-4 h-4 text-arda-accent" />
              Secure &amp; private
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.Activity className="w-4 h-4 text-arda-accent" />
              Live velocity signals
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/80 border border-arda-border shadow-arda">
              <Icons.Sparkles className="w-4 h-4 text-arda-accent" />
              AI-powered extraction
            </div>
          </div>
        </div>

        {/* Right: sign-in card */}
        <div className="arda-glass rounded-2xl p-8 lg:p-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm uppercase tracking-wide text-arda-text-muted">Sign in</p>
              <h2 className="text-2xl font-bold text-arda-text-primary">Continue with Arda</h2>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-arda-lg">
              <Icons.Inbox className="w-6 h-6 text-white" />
            </div>
          </div>

          <div className="space-y-4">
            {authError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                <div className="flex items-center gap-2 mb-1 font-semibold">
                  <Icons.AlertTriangle className="w-4 h-4" />
                  Authentication error
                </div>
                <div className="text-red-700/90">{authError}</div>
              </div>
            )}
            {onCheckingAuth ? (
              <div className="flex flex-col items-center py-6">
                <div className="animate-spin w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full mb-4" />
                <span className="text-arda-text-muted mb-4">Checking authentication...</span>
                <blockquote className="text-center px-4 transition-opacity duration-500">
                  <p className="text-sm italic text-arda-text-secondary">"{quote.quote}"</p>
                  <footer className="text-xs text-arda-text-muted mt-1">— {quote.author}</footer>
                </blockquote>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-arda-text-primary font-semibold py-3 px-4 rounded-xl transition-all shadow-arda-lg hover:shadow-arda-hover border border-arda-border"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            )}

            <div className="rounded-xl bg-arda-bg-secondary border border-arda-border p-4 text-sm text-arda-text-secondary">
              <div className="flex items-center gap-2 mb-2">
                <Icons.Lock className="w-4 h-4 text-arda-accent" />
                Your data stays private
              </div>
              <p className="text-arda-text-muted">
                We only request Gmail scopes required for purchase-order detection.
                Your email content is never stored or shared.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 text-center text-xs text-arda-text-muted">
            <div className="flex flex-col items-center gap-1">
              <Icons.Mail className="w-4 h-4 text-arda-accent" />
              Email ingestion
            </div>
            <div className="flex flex-col items-center gap-1">
              <Icons.TrendingUp className="w-4 h-4 text-arda-accent" />
              Velocity models
            </div>
            <div className="flex flex-col items-center gap-1">
              <Icons.Box className="w-4 h-4 text-arda-accent" />
              Kanban-ready items
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
