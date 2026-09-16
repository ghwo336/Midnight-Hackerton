import type { Metadata } from 'next';
import { IBM_Plex_Sans_KR } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

/** 한 서체만 쓴다. 위계는 굵기와 색으로 만든다 (DESIGN §3). */
const plex = IBM_Plex_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ONCE Finance',
  description: '장부를 공유하지 않고 매출채권 중복담보를 막는다',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={plex.className}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
