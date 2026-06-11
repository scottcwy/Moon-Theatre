export const metadata = {
  title: '剧本杀角色扮演 - Admin',
  description: '剧本杀角色扮演小程序管理后台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}