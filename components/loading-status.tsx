export function LoadingStatus({ children }: { children: React.ReactNode }) {
  return <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
    <progress aria-label="Загрузка" style={{ width: 48 }} />
    <span>{children}</span>
  </div>
}
