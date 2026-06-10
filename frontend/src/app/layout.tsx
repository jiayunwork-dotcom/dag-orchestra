import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DAG Orchestra - 数据流编排平台',
  description: '实时数据流DAG编排与运行监控全栈平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#0f172a] text-slate-100">
        {children}
      </body>
    </html>
  );
}
