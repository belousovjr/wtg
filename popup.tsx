import { t, nativeLanguageNames, getLanguage, subscribeLanguage, isLanguage } from "./lib/i18n"
import { selectLanguage, startLocaleClient } from "./lib/locale-sync"
import { useState, useEffect, useSyncExternalStore } from "react"
import { RoomPanel } from "./components/room-panel"
import { CHANNEL, sendRequest, type RuntimeStatus, type FrameStatus } from "./lib/messages"
import { Button } from "./components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion"
import { Alert, AlertDescription } from "./components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select"
import { Spinner } from "./components/ui/spinner"
import { ScanLine } from "lucide-react"
import logoUrl from "url:./assets/logo.svg"
import "./style.generated.css"

function IndexPopup() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
  useEffect(() => startLocaleClient(), [])
  const [status, setStatus] = useState<RuntimeStatus>()
  const [page, setPage] = useState<FrameStatus>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    setError("")
    setPage(undefined)
    try {
      setStatus(await sendRequest<RuntimeStatus>({ channel: CHANNEL, to: "background", type: "runtime-status" }))
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) throw new Error(t("popup.activeTabMissing"))
      setPage(await sendRequest<FrameStatus>({ channel: CHANNEL, to: "background", type: "frame-status", target: { tabId: tab.id, frameId: 0 } }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup.extensionError"))
    } finally { setBusy(false) }
  }

  return (
    <main className="w-full min-w-0 space-y-4 p-4 text-sm [overflow-wrap:anywhere]">
      <header className="flex items-center gap-3 py-1">
        <img src={logoUrl} alt={t("popup.logoAlt")} className="size-11 shrink-0 rounded-xl object-contain" width={44} height={44} />
        <div><h1 className="text-base font-semibold tracking-tight">Watchly</h1><p className="text-xs text-muted-foreground">{t("popup.tagline")}</p></div>
        <Select value={language} onValueChange={value => { if (isLanguage(value)) void selectLanguage(value).catch(cause => setError(cause instanceof Error ? cause.message : t("popup.languageSaveFailed"))) }}><SelectTrigger size="sm" className="ml-auto w-auto shrink-0 text-xs" aria-label={t("popup.language")}><SelectValue>{nativeLanguageNames[language]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(nativeLanguageNames).map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}</SelectContent></Select>
      </header>
      <RoomPanel />
      <Accordion type="single" collapsible><AccordionItem value="runtime" className="border-0">
        <AccordionTrigger className="text-xs text-muted-foreground">{t("popup.diagnostics")}</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={check}>{busy ? <Spinner /> : <ScanLine />}{t("popup.check")}</Button>
          {status && <Card size="sm"><CardHeader><CardTitle>{t("popup.connection")}</CardTitle></CardHeader><CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>{t("popup.webRtc", { availability: status.webRtcAvailable ? t("popup.available") : t("popup.unavailable") })}</p><p>{t("popup.context", { id: status.instanceId })}</p><p>{t("popup.started", { time: new Date(status.startedAt).toLocaleTimeString(language === "ru" ? "ru-RU" : "en-US") })}</p>
          </CardContent></Card>}
          {page && <p className="text-xs text-muted-foreground">{t("popup.pageResponds", { page: page.title || page.url })}</p>}
          {error && <Alert variant="destructive"><AlertDescription>{t("popup.pageError", { error })}</AlertDescription></Alert>}
        </AccordionContent>
      </AccordionItem></Accordion>
    </main>
  )
}

export default IndexPopup
