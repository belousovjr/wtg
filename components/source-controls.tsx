import { t } from "../lib/i18n"
import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { samePageLocation } from "../lib/source"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./ui/card"
import { Button } from "./ui/button"
import { Alert, AlertDescription } from "./ui/alert"
import { Spinner } from "./ui/spinner"
import { ExternalLink, Globe } from "lucide-react"
import { VideoPicker } from "./video-picker"
export function SourceControls({ room }: { room: RoomView }) {
  const [playerActions, setPlayerActions] = useState<HTMLDivElement | null>(null)
  const [tabError, setTabError] = useState("")
  const [tabBusy, setTabBusy] = useState(false)
  const [isViewingTab, setIsViewingTab] = useState(false)
  const [hasViewingTab, setHasViewingTab] = useState(false)
  const [wrongUrl, setWrongUrl] = useState(false)
  const [tabChecked, setTabChecked] = useState(false)
  useEffect(() => {
    let active = true
    setTabChecked(false)
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
      setTabChecked(true)
    }
    void refresh().catch(() => {})
    const timer = setInterval(() => void refresh().catch(() => {}), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [room.invitation, room.shared.url])
  async function openViewing() {
    setTabBusy(true)
    setTabError("")
    try {
      const actions = hasViewingTab ? ["source-open-url", "source-focus"] : ["source-attach"]
      for (const type of actions) {
        const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type })
        if (!reply?.ok) throw new Error(reply?.error || t("sourceControls.tabUnavailable"))
      }
    } catch (error) { setTabError(error instanceof Error ? error.message : t("sourceControls.tabUnavailable")) }
    finally { setTabBusy(false) }
  }
  return <Card size="sm"><CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle className="flex shrink-0 items-center gap-2"><Globe className="size-4 text-muted-foreground" />{t("sourceControls.viewing")}</CardTitle>
    <div ref={setPlayerActions} className="flex justify-end" />
    </CardHeader>
    <CardContent className="space-y-3">
    <VideoPicker room={room} actionContainer={playerActions} hidePreview={!!room.shared.url && (!tabChecked || !isViewingTab || wrongUrl)} />
    {room.shared.url && tabChecked && (!isViewingTab || wrongUrl) && <Alert><AlertDescription>{!hasViewingTab ? t("sourceControls.missingTab") : t("sourceControls.wrongTab")}</AlertDescription></Alert>}
    {room.shared.url && <CardDescription className="break-all text-xs">{room.shared.url}</CardDescription>}
    {room.shared.url && <>
      {tabChecked && isViewingTab && !wrongUrl && room.sourceReadiness[room.selfId]?.status === "unavailable" && <Alert><AlertDescription>{t("sourceControls.playerUnavailable")}</AlertDescription></Alert>}
      {tabChecked && (!isViewingTab || wrongUrl) && <Button size="sm" disabled={tabBusy} onClick={() => void openViewing()}>{tabBusy ? <Spinner /> : <ExternalLink />}{t("sourceControls.openViewing")}</Button>}
    </>}
    {tabError && <Alert variant="destructive"><AlertDescription>{tabError}</AlertDescription></Alert>}
    </CardContent>
  </Card>
}
