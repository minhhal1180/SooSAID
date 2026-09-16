import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'S.O.S Aid – Trực cấp cứu',
  description: 'Dashboard tổng đài và bác sĩ trực cho nền tảng hỗ trợ sơ cấp ngoại viện',
  // Dashboard chứa dữ liệu y tế: không để công cụ tìm kiếm lập chỉ mục.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
