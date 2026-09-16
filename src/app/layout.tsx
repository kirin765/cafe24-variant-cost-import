import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cafe24 옵션별 공급가 가져오기 데모",
  description:
    "합성 품목 목록과 공급가 CSV를 매칭·검증하고 변경 미리보기·명세를 확인하는 로컬 데모입니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
