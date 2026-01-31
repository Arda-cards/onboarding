/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Arda-inspired color palette
        arda: {
          // Orange accent - primary brand color
          accent: '#FC5A29',
          'accent-hover': '#E54D1F',
          
          // Light backgrounds
          bg: '#FFFFFF',
          'bg-secondary': '#F9FAFB',
          'bg-tertiary': '#F3F4F6',
          
          // Borders
          border: '#E5E7EB',
          'border-hover': '#D1D5DB',
          
          // Text colors
          'text-primary': '#111827',
          'text-secondary': '#4B5563',
          'text-muted': '#9CA3AF',
          
          // Status colors
          success: '#22C55E',
          warning: '#F59E0B',
          danger: '#EF4444',
          info: '#3B82F6',
          
          // Legacy dark theme (for gradual migration)
          900: '#0f1117',
          800: '#161b22',
          700: '#21262d',
          600: '#30363d',
          500: '#8b949e',
        }
      },
      borderRadius: {
        'arda': '8px',
        'arda-lg': '12px',
      },
      boxShadow: {
        'arda': '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
        'arda-lg': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'arda-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      }
    }
  },
  plugins: [],
}
