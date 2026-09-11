import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Tỷ Phú Việt — Ván cờ của bạn",
  description:
    "Board game mua bán bất động sản Việt Nam. Chơi cùng 2–6 người bạn theo thời gian thực.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
