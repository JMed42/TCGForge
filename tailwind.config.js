/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#0f1117',
          1: '#161821',
          2: '#1e2030',
          3: '#272a3a',
          4: '#313449',
        },
        accent: {
          DEFAULT: '#7c6ef0',
          hover: '#9387f5',
          muted: '#7c6ef020',
        },
        text: {
          primary: '#e4e6f0',
          secondary: '#8b8fa8',
          muted: '#5c6078',
        },
        border: {
          DEFAULT: '#2e3148',
          hover: '#3d4160',
        },
        success: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
      },
    },
  },
  plugins: [],
};
