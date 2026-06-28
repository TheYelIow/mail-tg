export const metadata = {
  title: "tg-mail-bot",
  description: "Email ↔ Telegram bridge powered by Resend",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          maxWidth: 640,
          margin: "4rem auto",
          padding: "0 1.5rem",
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  );
}
