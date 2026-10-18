import { Spinner } from "./ui/spinner"
export function LoadingStatus({ children }: { children: React.ReactNode }) {
  return <div role="status" aria-live="polite" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
    <Spinner aria-label="Загрузка" />
    <span>{children}</span>
  </div>
}
