// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

/** @param {string} path */
const repoPath = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  site: 'https://polycss.com',
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: /^@polycss\/core$/,
          replacement: repoPath('../packages/core/src/index.ts'),
        },
        {
          find: /^@polycss\/react$/,
          replacement: repoPath('../packages/react/src/index.ts'),
        },
        {
          find: /^@polycss\/vue$/,
          replacement: repoPath('../packages/vue/src/index.ts'),
        },
        {
          find: /^@layoutit\/polycss\/elements$/,
          replacement: repoPath('../packages/polycss/src/elements/index.ts'),
        },
        {
          find: /^@layoutit\/polycss-fonts$/,
          replacement: repoPath('../packages/fonts/src/index.ts'),
        },
        {
          find: /^@layoutit\/polycss$/,
          replacement: repoPath('../packages/polycss/src/index.ts'),
        },
      ],
    },
  },
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: 'PolyCSS',
      description: 'A CSS polygon mesh engine. DOM-native 3D rendering.',
      favicon: '/favicon.ico',
      head: [
        // Google Analytics (gtag.js) — covers all Starlight docs pages; custom
        // pages render the same tag via src/components/Analytics.astro.
        { tag: 'script', attrs: { async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-XV72TXWTM5' } },
        { tag: 'script', content: "window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-XV72TXWTM5');" },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://polycss.com/polycss-github.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1280' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '640' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'PolyCSS logo, a rendered polygon duck, and DOM markup.' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://polycss.com/polycss-github.png' } },
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: 'PolyCSS logo, a rendered polygon duck, and DOM markup.' } },
      ],
      disable404Route: true,
      components: {
        Header: './src/components/DocsHeader.astro',
        ThemeSelect: './src/components/EmptyThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/LayoutitStudio/polycss' },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Quickstart', slug: 'quickstart' },
            { label: 'Core Concepts', slug: 'core-concepts' },
          ],
        },
        {
          label: 'Components',
          items: [
            { label: 'PolyScene', slug: 'components/poly-scene' },
            { label: 'PolyCamera', slug: 'components/poly-camera' },
            { label: 'Controls', slug: 'components/poly-controls' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Loading Meshes', slug: 'guides/textures' },
            { label: 'Lighting & Shadows', slug: 'guides/lighting' },
            { label: 'Per-polygon Interaction', slug: 'guides/shapes' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Projections', slug: 'guides/projections' },
            { label: 'Animation', slug: 'guides/animation' },
            { label: 'Morph', slug: 'guides/morph' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Headless API', slug: 'api/headless' },
            { label: 'Three.js Parity API', slug: 'api/three-parity' },
            { label: 'Core Types', slug: 'api/types' },
            { label: 'Fonts API', slug: 'api/fonts' },
          ],
        },
      ],
    }),
  ],
});
