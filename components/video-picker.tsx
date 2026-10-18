import { t } from "../lib/i18n"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos, VideoInfo } from "../lib/video"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { sameVideoSelection, sourceRevision } from "../lib/source"
import { Button } from "./ui/button"
import { Alert, AlertDescription } from "./ui/alert"
import { Card, CardContent } from "./ui/card"
import { Badge } from "./ui/badge"
import { Spinner } from "./ui/spinner"
import { MonitorPlay, TvMinimalPlay, Link2, Pause, Play } from "lucide-react"

export function SelectedVideoPreview({ video, bound, duration, selector }: { video?: VideoInfo; bound: boolean; duration: number | null; selector?: string }) {
  const [posterFailed, setPosterFailed] = useState(false)
  useEffect(() => setPosterFailed(false), [video?.poster])
  const time = duration === null ? null : `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
  return <Card size="sm" className="gap-0 overflow-hidden py-0" aria-label={t("videoPicker.selectedVideo")}>
    <div className="relative flex h-28 items-center justify-center overflow-hidden bg-secondary">
      {video?.poster && !posterFailed ? <img src={video.poster} alt={t("videoPicker.posterAlt")} referrerPolicy="no-referrer" onError={() => setPosterFailed(true)} className="absolute inset-0 size-full object-cover" /> : <TvMinimalPlay className="size-10 text-primary/60" aria-hidden="true" />}
      {selector && <Badge className="absolute left-2 top-2 max-w-[calc(100%-1rem)] min-w-0" variant="secondary" title={selector}><code className="truncate font-mono text-[10px] font-normal">{selector}</code></Badge>}
      {time && <Badge className="absolute bottom-2 right-2 bg-background/90 text-foreground" variant="secondary">{time}</Badge>}
    </div>
    <CardContent className="space-y-2 py-3">
      <p className="truncate text-sm font-medium" title={video?.label || t("videoPicker.sharedPlayer")}>{video?.label || t("videoPicker.sharedPlayer")}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" role="status">{bound ? <Link2 className="size-3" /> : <Spinner className="size-3" />}{bound ? t("videoPicker.bound") : t("videoPicker.searching")}</Badge>
        {bound && video && <span className="flex items-center gap-1 text-muted-foreground">{video.readyState < 2 ? t("videoPicker.loading") : video.paused ? <><Pause className="size-3" />{t("videoPicker.paused")}</> : <><Play className="size-3" />{t("videoPicker.playing")}</>}</span>}
      </div>
    </CardContent>
  </Card>
}

export function VideoPicker({ room, actionContainer, hidePreview = false }: { room: RoomView; actionContainer?: HTMLElement | null; hidePreview?: boolean }) {
  const [data, setData] = useState<TabVideos>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        const stored = (await chrome.storage.session.get("sourceViewer")).sourceViewer
        const roomId = room.invitation ? decodeInvitation(room.invitation).roomId : null
        const viewingId = stored?.roomId === roomId && stored?.boundByUser && !stored.closed ? stored.tabId : undefined
        const id = viewingId ?? tab?.id
        if (id === undefined) throw new Error(t("videoPicker.tabUnavailable"))
        const result = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: id })
        if (active) { setData(result); setError("") }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : t("videoPicker.pageUnavailable")) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [room.invitation])
  async function pick() {
    setBusy(true)
    setError("")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) throw new Error(t("videoPicker.activeTabMissing"))
      const current = await sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command: { kind: "status" } })
      if (!current.ready || !current.invitation) throw new Error(t("videoPicker.joinFirst"))
      const videos = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: tab.id })
      if (!videos.frames.length) throw new Error(t("videoPicker.refreshPage"))
      const context = { roomId: decodeInvitation(current.invitation).roomId, revision: sourceRevision(current.shared) }
      await Promise.all(videos.frames.map(frame => sendRequest({ channel: CHANNEL, to: "background", type: "video", target: { tabId: tab.id!, frameId: frame.frameId }, action: { kind: "pick", shared: context } })))
      window.close()
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("videoPicker.pickFailed")) }
    finally { setBusy(false) }
  }
  let roomId = ""
  try { if (room.invitation) roomId = decodeInvitation(room.invitation).roomId } catch {}
  const boundFrame = data?.frames.find(frame => frame.snapshot.roomBinding?.roomId === roomId &&
    frame.snapshot.roomBinding.revision === sourceRevision(room.shared) && frame.snapshot.binding === "bound" &&
    frame.snapshot.selectedId === frame.snapshot.roomBinding.videoId)
  const bound = boundFrame?.snapshot.videos.find(video => video.id === boundFrame.snapshot.roomBinding?.videoId)
  const current = bound || data?.frames.flatMap(frame => frame.snapshot.videos).find(video => sameVideoSelection(video.descriptor, room.shared.video))
  const action = <Button size="sm" title={t("videoPicker.pickTitle")} disabled={busy || !room.ready} onClick={() => void pick()}><MonitorPlay />{room.shared.video ? t("videoPicker.changeForAll") : t("videoPicker.chooseForAll")}</Button>
  return <section className="space-y-3">
    {actionContainer ? createPortal(action, actionContainer) : actionContainer === undefined ? action : null}
    {!hidePreview && (room.shared.video ? <SelectedVideoPreview video={current} bound={!!bound} selector={room.shared.video.selector} duration={current?.duration ?? room.shared.video.duration ?? null} /> : <p className="text-xs text-muted-foreground">{t("videoPicker.noVideo")}</p>)}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </section>
}
