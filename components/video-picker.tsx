import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos, VideoAction, VideoDescriptor, VideoSnapshot } from "../lib/video"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { sameVideoSelection, sourceRevision } from "../lib/source"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/card"
import { Badge } from "./ui/badge"
import { Alert, AlertDescription } from "./ui/alert"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion"
import { Spinner } from "./ui/spinner"
import { MonitorPlay, MousePointer2, Check, RefreshCw, Share2 } from "lucide-react"

export function VideoPicker() {
  const [tabId, setTabId] = useState<number>()
  const [data, setData] = useState<TabVideos>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [room, setRoom] = useState<RoomView>()
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState<{ video: VideoDescriptor; revision: number; invitation: string | null }>()

  async function refresh(id = tabId) {
    if (id === undefined) return
    try {
      const [result, currentRoom] = await Promise.all([
        sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: id }),
        sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command: { kind: "status" } })
      ])
      setData(result)
      setRoom(currentRoom)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Страница недоступна") }
  }
  useEffect(() => {
    let mounted = true
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!mounted) return
      if (tab?.id === undefined) { setError("Активная вкладка не найдена"); return }
      setTabId(tab.id)
      void refresh(tab.id)
    })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [tabId])
  useEffect(() => {
    if (!pending || !room) return
    if (room.invitation !== pending.invitation) {
      setPending(undefined)
      setError("Комната изменилась. Выбери видео заново.")
    } else if (sourceRevision(room.shared) > pending.revision) {
      setPending(undefined)
      if (sameVideoSelection(pending.video, room.shared.video)) setNotice("✓ Выбор принят комнатой.")
      else setError("Источник комнаты изменён другим участником. Проверь выбранное видео.")
    }
  }, [pending, room])
  useEffect(() => {
    if (!pending) return
    const timeout = setTimeout(() => {
      setPending(undefined)
      setError("Не получили подтверждение выбора за 15 секунд. Проверь соединение и статус комнаты.")
    }, 15000)
    return () => clearTimeout(timeout)
  }, [pending])

  async function action(frameId: number, action: VideoAction) {
    if (tabId === undefined) return
    try {
      await sendRequest<VideoSnapshot>({ channel: CHANNEL, to: "background", type: "video", target: { tabId, frameId }, action })
      if (action.kind === "pick") window.close()
      else if (action.kind !== "highlight") await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка выбора") }
  }
  async function pick() {
    if (!data) return
    setBusy(true)
    try {
      // Await all frames before closing the popup.
      await Promise.all(data.frames.map(frame => sendRequest({ channel: CHANNEL, to: "background", type: "video", target: { tabId: tabId!, frameId: frame.frameId }, action: { kind: "pick" } })))
      window.close()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось включить выбор") }
    finally { setBusy(false) }
  }
  async function share(video: TabVideos["frames"][number]["snapshot"]["videos"][number]) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const currentRoom = await sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command: { kind: "status" } })
      if (!currentRoom.ready) throw new Error("Сначала подключись к комнате")
      setRoom(currentRoom)
      setPending({ video: video.descriptor, revision: sourceRevision(currentRoom.shared), invitation: currentRoom.invitation })
      const updated = await sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command: {
        kind: "source", url: video.descriptor.pageUrl, video: video.descriptor, expectedRevision: sourceRevision(currentRoom.shared), commandId: crypto.randomUUID()
      } })
      setRoom(updated)
    } catch (cause) { setPending(undefined); setError(cause instanceof Error ? cause.message : "Не удалось изменить источник") }
    finally { setBusy(false) }
  }
  const count = data?.frames.reduce((sum, frame) => sum + frame.snapshot.videos.length, 0) || 0
  let roomId = ""
  try { if (room?.invitation) roomId = decodeInvitation(room.invitation).roomId } catch {}
  const locallyBound = (frame: TabVideos["frames"][number], id?: string) => !!room?.ready &&
    frame.snapshot.roomBinding?.roomId === roomId && frame.snapshot.roomBinding?.revision === sourceRevision(room.shared) &&
    frame.snapshot.binding === "bound" && frame.snapshot.selectedId === frame.snapshot.roomBinding.videoId && (!id || id === frame.snapshot.roomBinding.videoId)
  return <section className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><MonitorPlay className="size-4 text-muted-foreground" />Плееры</h3><Badge variant="secondary">{count}</Badge></div>
    {room?.shared.video && <p className="text-xs text-muted-foreground">{data?.frames.flatMap(frame => frame.snapshot.videos).find(video => sameVideoSelection(video.descriptor, room.shared.video))?.label || "Общий плеер"} · {data?.frames.some(frame => locallyBound(frame)) ? "Привязан у тебя" : "Привязка на этой странице не подтверждена"}</p>}
    {pending && <Alert><Spinner /><AlertDescription>Применяем выбор для комнаты…</AlertDescription></Alert>}
    {!pending && notice && <Alert><Check /><AlertDescription>{notice}</AlertDescription></Alert>}
    <div className="space-y-3">
    <Button variant="outline" size="sm" disabled={busy || !data?.frames.length} onClick={pick}><MousePointer2 />Указать мой плеер</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">Нажми на плеер на странице. Escape — отмена. Это локальная привязка; общий выбор меняется кнопкой «Выбрать для всех».</p>
    {data?.frames.map(frame => <div key={frame.frameId}>
      {!locallyBound(frame) && frame.snapshot.notice && <Alert className="mb-3"><AlertDescription>{frame.snapshot.notice}</AlertDescription></Alert>}
      {!locallyBound(frame) && (frame.snapshot.binding === "missing" || frame.snapshot.binding === "ambiguous") ? <Alert className="mb-3"><AlertDescription>Привязка на этой странице потеряна. Выбери плеер у себя.</AlertDescription></Alert> : null}
      {frame.snapshot.videos.map(video => <Card size="sm" key={video.id}
        onMouseEnter={() => void action(frame.frameId, { kind: "highlight", id: video.id })}
        onMouseLeave={() => void action(frame.frameId, { kind: "highlight", id: null })}
        className="mt-3">
        {video.poster && <img src={video.poster} alt="" referrerPolicy="no-referrer" className="max-h-32 w-full object-cover" />}
        <CardHeader><div className="flex flex-wrap gap-1.5">
          {room?.ready && sameVideoSelection(video.descriptor, room.shared.video) && <Badge variant="secondary">Выбор группы</Badge>}
          {locallyBound(frame, video.id) ? <Badge variant="outline"><Check className="size-3" />Привязан у тебя</Badge> : frame.snapshot.selectedId === video.id ? <Badge variant="outline">Выбран локально</Badge> : null}
        </div><CardTitle>{video.label}</CardTitle>
        <CardDescription className="text-xs">{video.width}×{video.height} · {video.duration === null ? "live / неизвестно" : `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`} · {video.readyState < 2 ? "Загружается" : video.paused ? "Пауза" : "Играет"}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p className="break-all">{frame.frameId === 0 ? "Основная страница" : `Фрейм: ${frame.url}`}</p>
          <Accordion type="single" collapsible><AccordionItem value="selector" className="border-0"><AccordionTrigger className="text-xs">Диагностика локального селектора</AccordionTrigger><AccordionContent className="space-y-2 text-xs"><code className="break-all">{video.descriptor.selector}</code>{!!video.descriptor.shadowPath.length && <p>Shadow DOM: <code>{video.descriptor.shadowPath.join(" → ")}</code></p>}</AccordionContent></AccordionItem></Accordion>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {room?.shared.video && !data?.frames.some(f => locallyBound(f)) && <Button variant="outline" size="sm" title="Только локальная привязка, без смены видео группы" onClick={() => void action(frame.frameId, { kind: "select", id: video.id })}>Это мой плеер</Button>}
          <Button size="sm" disabled={busy || !!pending || !room?.ready} onClick={() => void share(video)}>{pending && sameVideoSelection(pending.video, video.descriptor) ? <Spinner /> : <Share2 />}{pending && sameVideoSelection(pending.video, video.descriptor) ? "Применяем…" : "Выбрать для всех"}</Button>
        </CardFooter>
      </Card>)}
    </div>)}
    {data && !count && <Alert><MonitorPlay /><AlertDescription>Видео не найдены. Запусти плеер или обнови страницу. Закрытые Shadow DOM недоступны.</AlertDescription></Alert>}
    </div>
    <Accordion type="single" collapsible><AccordionItem value="player" className="border-0"><AccordionTrigger className="text-xs text-muted-foreground">Диагностика плеера</AccordionTrigger><AccordionContent className="space-y-3 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw />Обновить список</Button>
      {room?.shared.video && <div className="space-y-2 break-all">
        <p>Общий CSS-селектор · ревизия {sourceRevision(room.shared)}: <code>{room.shared.video.selector}</code></p>
        <p>Shadow DOM: <code>{room.shared.video.shadowPath.join(" → ") || "нет"}</code></p>
        <p>Фрейм: {room.shared.video.frameUrl}</p>
        <p>Путь фреймов (URL): {room.shared.video.framePath.join(" → ") || "Основная страница"}</p>
      </div>}
      <p>Недоступных фреймов: {data?.unavailableFrames ?? "—"}.</p>
    </AccordionContent></AccordionItem></Accordion>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {room?.error && room.error !== error && <Alert variant="destructive"><AlertDescription>{room.error}</AlertDescription></Alert>}
  </section>
}
