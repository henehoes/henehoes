// The GitHub Pages build (VITE_DATAMINE=1) gets its own tab title and Bunny Slippers icons (scripts/make-favicon.mjs).
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [{
    name: 'pro-tab',
    transformIndexHtml: html => loadEnv(mode, process.cwd()).VITE_DATAMINE !== '1' ? html : html
      .replace('<title>classic henehoes</title>', '<title>henehoes pro</title>')
      .replace(/href="\/(favicon-32|favicon|apple-touch-icon)\.png"/g, 'href="/pro-$1.png"'),
  }],
}));
