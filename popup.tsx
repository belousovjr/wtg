import { useState } from "react"
import { RoomPanel } from "./components/room-panel"
import { CHANNEL, sendRequest, type RuntimeStatus, type FrameStatus } from "./lib/messages"
import { Button } from "./components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./components/ui/accordion"
import { Alert, AlertDescription } from "./components/ui/alert"
import { Badge } from "./components/ui/badge"
import { Spinner } from "./components/ui/spinner"
import { Radio, ScanLine } from "lucide-react"
import logoUrl from "url:./assets/logo.svg"
import "./style.generated.css"

function IndexPopup() {
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
      if (tab?.id === undefined) throw new Error("Активная вкладка не найдена")
      setPage(await sendRequest<FrameStatus>({ channel: CHANNEL, to: "background", type: "frame-status", target: { tabId: tab.id, frameId: 0 } }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка расширения")
    } finally { setBusy(false) }
  }

  return (
    <main className="w-full min-w-0 space-y-4 p-4 text-sm [overflow-wrap:anywhere]">
      <header className="flex items-center gap-3 py-1">
        <img src={logoUrl} alt="Логотип Watch Together" className="size-11 shrink-0 rounded-xl object-contain" width={44} height={44} />
        <div><h1 className="text-base font-semibold tracking-tight">Watch Together</h1><p className="text-xs text-muted-foreground">Один просмотр. Вместе.</p></div>
        <Badge variant="secondary" className="ml-auto"><Radio className="size-3" />P2P</Badge>
      </header>
      <RoomPanel />
      <Accordion type="single" collapsible><AccordionItem value="runtime" className="border-0">
        <AccordionTrigger className="text-xs text-muted-foreground">Диагностика расширения</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <Button variant="outline" size="sm" disabled={busy} onClick={check}>{busy ? <Spinner /> : <ScanLine />}Проверить</Button>
          {status && <Card size="sm"><CardHeader><CardTitle>Соединение</CardTitle></CardHeader><CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>WebRTC: {status.webRtcAvailable ? "доступен" : "недоступен"}</p><p>Контекст: {status.instanceId}</p><p>Запущен: {new Date(status.startedAt).toLocaleTimeString()}</p>
          </CardContent></Card>}
          {page && <p className="text-xs text-muted-foreground">Страница отвечает: {page.title || page.url}</p>}
          {error && <Alert variant="destructive"><AlertDescription>{error}. Для обычной страницы попробуй обновить вкладку.</AlertDescription></Alert>}
        </AccordionContent>
      </AccordionItem></Accordion>
    </main>
  )
}

export default IndexPopup
