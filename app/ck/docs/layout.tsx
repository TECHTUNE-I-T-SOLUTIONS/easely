import React from "react";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased font-sans">
      {children}
    </div>
  );
}
