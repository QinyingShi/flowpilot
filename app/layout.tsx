import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  ),
  title: 'FlowPilot · AI 项目指挥中心',
  description:
    '覆盖 WBS、里程碑、资源负载、进度风险与 AI 自动巡检的项目管理工作台',
  openGraph: {
    title: 'FlowPilot AI 项目指挥中心',
    description: '让计划、资源与风险实时联动',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FlowPilot AI 项目指挥中心',
    description: '让计划、资源与风险实时联动',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
