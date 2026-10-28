/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wood: {
          light: '#f3d9b1',
          DEFAULT: '#e2b887',
          dark: '#b88655',
          border: '#5c3a1e',
        },
      },
    },
  },
  plugins: [],
};
