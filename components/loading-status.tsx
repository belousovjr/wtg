import { t } from "../lib/i18n"
import { Spinner } from "./ui/spinner"
export function LoadingStatus({ children }: { children: React.ReactNode }) {
  return <div role="status" aria-live="polite" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
    <Spinner aria-label={t("loadingStatus.loading")} />
    <span>{children}</span>
  </div>
}
