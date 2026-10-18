import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { samePageLocation } from "../lib/source"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./ui/card"
import { Button } from "./ui/button"
import { Alert, AlertDescription } from "./ui/alert"
import { Spinner } from "./ui/spinner"
import { ExternalLink, ArrowRightLeft, Globe } from "lucide-react"
export function SourceControls({ room }: { room: RoomView }) {
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
  return <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="size-4 text-muted-foreground" />Просмотр</CardTitle>
    <CardDescription className="break-all text-xs">{room.shared.url || "Выбери плеер ниже — страница передастся вместе с видео."}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
    {room.shared.url && <>
      {!room.shared.video && <p className="text-xs text-muted-foreground">Страница задана. Теперь выбери видео для группы ниже.</p>}
      {room.sourceReadiness[room.selfId]?.status === "unavailable" && <Alert><AlertDescription>Вкладка просмотра не привязана, закрыта или плеер недоступен.</AlertDescription></Alert>}
      {!isViewingTab && hasViewingTab && <Button variant="outline" size="sm" disabled={tabBusy} onClick={() => void tabAction("source-focus")}><ExternalLink />К вкладке просмотра</Button>}
      {wrongUrl && <Button size="sm" disabled={tabBusy} onClick={() => void tabAction("source-open-url")}>{tabBusy ? <Spinner /> : <ExternalLink />}Открыть страницу просмотра</Button>}
      {!hasViewingTab ? <Button size="sm" disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Смотреть в этой вкладке</Button> : !isViewingTab && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Текущая вкладка станет вкладкой просмотра и откроет общий URL.</p>
        <Button variant="outline" size="sm" disabled={tabBusy} onClick={() => void tabAction("source-attach")}><ArrowRightLeft />Перенести в эту вкладку</Button>
      </div>}
    </>}
    {tabError && <Alert variant="destructive"><AlertDescription>{tabError}</AlertDescription></Alert>}
    </CardContent>
  </Card>
}
