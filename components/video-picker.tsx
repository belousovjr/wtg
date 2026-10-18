import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos } from "../lib/video"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { sameVideoSelection, sourceRevision } from "../lib/source"
import { Button } from "./ui/button"
import { Alert, AlertDescription } from "./ui/alert"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion"
import { MousePointer2, Share2 } from "lucide-react"

export function VideoPicker({ room }: { room: RoomView }) {
  const [data, setData] = useState<TabVideos>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab?.id === undefined) throw new Error("Активная вкладка не найдена")
        const result = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: tab.id })
        if (active) { setData(result); setError("") }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Страница недоступна") }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  async function pick(shared: boolean) {
    setBusy(true)
    setError("")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) throw new Error("Активная вкладка не найдена")
      const current = await sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command: { kind: "status" } })
      if (!current.ready || !current.invitation) throw new Error("Сначала подключись к комнате")
      const videos = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: tab.id })
      if (!videos.frames.length) throw new Error("Страница недоступна. Обнови её и попробуй снова.")
      const context = shared ? { roomId: decodeInvitation(current.invitation).roomId, revision: sourceRevision(current.shared) } : undefined
      await Promise.all(videos.frames.map(frame => sendRequest({ channel: CHANNEL, to: "background", type: "video", target: { tabId: tab.id!, frameId: frame.frameId }, action: { kind: "pick", shared: context } })))
      window.close()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось включить выбор") }
    finally { setBusy(false) }
  }
  let roomId = ""
  try { if (room.invitation) roomId = decodeInvitation(room.invitation).roomId } catch {}
  const boundFrame = data?.frames.find(frame => frame.snapshot.roomBinding?.roomId === roomId &&
    frame.snapshot.roomBinding.revision === sourceRevision(room.shared) && frame.snapshot.binding === "bound" &&
    frame.snapshot.selectedId === frame.snapshot.roomBinding.videoId)
  const bound = boundFrame?.snapshot.videos.find(video => video.id === boundFrame.snapshot.roomBinding?.videoId)
  const current = bound || data?.frames.flatMap(frame => frame.snapshot.videos).find(video => sameVideoSelection(video.descriptor, room.shared.video))
  return <section className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || !room.ready} onClick={() => void pick(true)}><Share2 />{room.shared.video ? "Сменить плеер для всех" : "Выбрать плеер для всех"}</Button>
      {room.shared.video && !bound && <Button variant="outline" size="sm" disabled={busy || !room.ready} onClick={() => void pick(false)}><MousePointer2 />Выбрать плеер для меня</Button>}
    </div>
    <p className="text-xs text-muted-foreground">После нажатия выбери плеер кликом на странице. Escape — отмена.</p>
    {room.shared.video ? <div className="space-y-1 text-xs">
      <p className="font-medium">{current?.label || "Общий плеер"}</p>
      <p className="text-muted-foreground">{bound ? "Привязан у тебя" : "Нужно выбрать плеер у тебя"}</p>
      {current && <p className="text-muted-foreground">{current.width}×{current.height} · {current.duration === null ? "Длительность неизвестна" : `${Math.floor(current.duration / 60)}:${String(Math.floor(current.duration % 60)).padStart(2, "0")}`} · {current.readyState < 2 ? "Загружается" : current.paused ? "Пауза" : "Играет"}</p>}
    </div> : <p className="text-xs text-muted-foreground">Общий плеер ещё не выбран.</p>}
    <Accordion type="single" collapsible><AccordionItem value="player" className="border-0"><AccordionTrigger className="text-xs text-muted-foreground">Диагностика плеера</AccordionTrigger><AccordionContent className="space-y-2 text-xs text-muted-foreground">
      {room.shared.video && <div className="space-y-2 break-all">
        <p>Общий CSS-селектор · ревизия {sourceRevision(room.shared)}: <code>{room.shared.video.selector}</code></p>
        <p>Shadow DOM: <code>{room.shared.video.shadowPath.join(" → ") || "нет"}</code></p>
        <p>Фрейм: {room.shared.video.frameUrl}</p>
        <p>Путь фреймов: {room.shared.video.framePath.join(" → ") || "Основная страница"}</p>
      </div>}
      {bound && <p>Локальный селектор: <code>{bound.descriptor.selector}</code></p>}
      {data?.frames.map(frame => frame.snapshot.notice && <p key={frame.frameId}>{frame.snapshot.notice}</p>)}
      <p>Недоступных фреймов: {data?.unavailableFrames ?? "—"}.</p>
    </AccordionContent></AccordionItem></Accordion>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </section>
}
