import type { MetadataRoute } from 'next';

/**
 * Makes "Add to Home Screen" produce a standalone app rather than a browser
 * shortcut: its own icon, no address bar, and the terminal background painted
 * behind it during launch.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KOKOMOJI / ASCII',
    short_name: 'KOKOMOJI',
    description:
      'Pixel-art robot heads resampled onto a character grid, with a terminal decode.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1a1029',
    theme_color: '#1a1029',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
