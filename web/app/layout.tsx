import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KOKOMOJI / ASCII',
  description:
    'Pixel-art robot heads resampled onto a character grid, with a terminal decode.',
  // Launched from the home screen this runs fullscreen, with the status bar
  // drawn over the page's own dark background.
  appleWebApp: {
    capable: true,
    title: 'KOKOMOJI',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#1a1029',
  colorScheme: 'dark',
  // The grid is a fixed composition; letting it be pinch-zoomed only ever
  // desyncs the fitted font size from the viewport.
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
