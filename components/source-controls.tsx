import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { samePageLocation } from "../lib/source"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./ui/card"
import { Button } from "./ui/button"
import { Alert, AlertDescription } from "./ui/alert"
import { Spinner } from "./ui/spinner"
import { ExternalLink, ArrowRightLeft, Globe } from "lucide-react"
import { VideoPicker } from "./video-picker"
export function SourceControls({ room }: { room: RoomView }) {
  const [playerActions, setPlayerActions] = useState<HTMLDivElement | null>(null)
  const [tabError, setTabError] = useState("")
  const [tabBusy, setTabBusy] = useState(false)
  const [isViewingTab, setIsViewingTab] = useState(false)
  const [hasViewingTab, setHasViewingTab] = useState(false)
  const [wrongUrl, setWrongUrl] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const [stored, tabs] = await Promise.all([chrome.storage.session.get("sourceViewer"), chrome.tabs.query({ active: true, currentWindow: true })])
      const viewer = stored.sourceViewer
      if (!active) return
      const belongs = !!room.invitation && viewer?.roomId === decodeInvitation(room.invitation).roomId
      const viewingTab = belongs && viewer?.boundByUser && !viewer.closed ? await chrome.tabs.get(viewer.tabId).catch(() => undefined) : undefined
      if (!active) return
      setWrongUrl(!!viewingTab && !!room.shared.url && !samePageLocation(viewingTab.url || "", room.shared.url))
      setHasViewingTab(!!viewingTab)
      setIsViewingTab(!!viewingTab && viewer.tabId === tabs[0]?.id)
    }
    void refresh().catch(() => {})
    const timer = setInterval(() => void refresh().catch(() => {}), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [room.invitation, room.shared.url])
  async function tabAction(type: "source-focus" | "source-attach" | "source-open-url") {
    setTabBusy(true)
    setTabError("")
    try {
      const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type })
      if (!reply?.ok) throw new Error(reply?.error || "Вкладка просмотра недоступна")
    } catch (error) { setTabError(error instanceof Error ? error.message : "Вкладка просмотра недоступна") }
    finally { setTabBusy(false) }
  }
  return <Card size="sm"><CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle className="flex shrink-0 items-center gap-2"><Globe className="size-4 text-muted-foreground" />Просмотр</CardTitle>
    <div ref={setPlayerActions} className="flex justify-end" />
    </CardHeader>
    <CardContent className="space-y-3">
    <VideoPicker room={room} actionContainer={playerActions} />
    {room.shared.url && <CardDescription className="break-all text-xs">{room.shared.url}</CardDescription>}
    {room.shared.url && <>
      {room.sourceReadiness[room.selfId]?.status === "unavailable" && <Alert><AlertDescription>Вкладка просмотра не привязана, закрыта или плеер недоступен.</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {!isViewingTab && hasViewingTab && <Button variant="outline" size="icon-sm" title="Перейти к вкладке просмотра" aria-label="Перейти к вкладке просмотра" disabled={tabBusy} onClick={() => void tabAction("source-focus")}><ExternalLink /></Button>}
        {wrongUrl && <Button size="sm" title="Открыть общий URL во вкладке просмотра" disabled={tabBusy} onClick={() => void tabAction("source-open-url")}>{tabBusy ? <Spinner /> : <ExternalLink />}Открыть страницу</Button>}
        {!hasViewingTab ? <Button size="sm" title="Назначить текущую вкладку для просмотра" disabled={tabBusy} onClick={() => void tabAction("source-attach")}><ArrowRightLeft />Смотреть здесь</Button> : !isViewingTab && <Button variant="outline" size="sm" title="Перенести просмотр сюда и открыть общий URL" disabled={tabBusy} onClick={() => void tabAction("source-attach")}><ArrowRightLeft />Перенести сюда</Button>}
      </div>
    </>}
    {tabError && <Alert variant="destructive"><AlertDescription>{tabError}</AlertDescription></Alert>}
    </CardContent>
  </Card>
}
