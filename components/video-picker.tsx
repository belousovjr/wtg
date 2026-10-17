import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos, VideoAction, VideoDescriptor, VideoSnapshot } from "../lib/video"
import type { RoomView } from "../lib/room-protocol"
import { sameVideoSelection, sourceRevision } from "../lib/source"

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
  return <section>
    <h3>Видео на странице ({count})</h3>
    {pending && <p role="status">⏳ Применяем выбор для комнаты…</p>}
    {!pending && notice && <p role="status">{notice}</p>}
    {room?.ready && room.shared.video && <p role="status" style={{ color: "#166534" }}>
      Выбор комнаты сохранён. Плеер найден у {room.participants.filter(id => {
        const status = room.sourceReadiness[id]
        return status?.revision === sourceRevision(room.shared) && (status.status === "ready" || status.status === "loading-video")
      }).length} из {room.participants.length} участников.
    </p>}
    <button disabled={busy || !data?.frames.length} onClick={pick}>Выбрать плеер у меня на странице</button>{" "}
    <button onClick={() => void refresh()}>Обновить</button>
    <p>Наведи на плеер и нажми. Escape — отмена. После выбора открой расширение снова.</p>
    {data?.frames.map(frame => <div key={frame.frameId}>
      {frame.snapshot.notice && <p role="status">{frame.snapshot.notice}</p>}
      {frame.snapshot.binding === "missing" || frame.snapshot.binding === "ambiguous" ? <p role="status">Привязка потеряна или неоднозначна. Выбери видео заново.</p> : null}
      {frame.snapshot.videos.map(video => <article key={video.id}
        onMouseEnter={() => void action(frame.frameId, { kind: "highlight", id: video.id })}
        onMouseLeave={() => void action(frame.frameId, { kind: "highlight", id: null })}
        style={{ border: sameVideoSelection(video.descriptor, room?.shared.video) && room?.ready ? "2px solid #15803d" : "1px solid #ccc", background: sameVideoSelection(video.descriptor, room?.shared.video) && room?.ready ? "#f0fdf4" : undefined, borderRadius: 8, padding: 10, marginTop: 8 }}>
        {room?.ready && sameVideoSelection(video.descriptor, room.shared.video) && <p style={{ color: "#166534", fontWeight: 700 }}>✓ Выбрано для комнаты</p>}
        {video.poster && <img src={video.poster} alt="" referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: 100 }} />}
        <strong>{video.label}</strong>
        <p>{video.width}×{video.height} · {video.duration === null ? "Длительность неизвестна / live" : `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`} · {video.readyState < 2 ? "Загружается" : video.paused ? "Пауза" : "Играет"}</p>
        <small>{frame.frameId === 0 ? "Основная страница" : `Фрейм: ${frame.url}`}</small><br />
        <button onClick={() => void action(frame.frameId, { kind: "select", id: video.id })}>{frame.snapshot.selectedId === video.id ? "✓ Выбрано у меня" : "Выбрать плеер у меня"}</button>{" "}
        <button disabled={busy || !!pending} onClick={() => void share(video)}>{pending && sameVideoSelection(pending.video, video.descriptor) ? "Применяем выбор…" : room?.ready && sameVideoSelection(video.descriptor, room.shared.video) ? "Выбрано для комнаты · выбрать снова" : "Смотреть это вместе"}</button>
        <p><small>Задаст общий источник в привязанных вкладках всех участников.</small></p>
      </article>)}
    </div>)}
    {data && !count && <p>Доступные видео не найдены. Запусти плеер или обнови страницу. Закрытые Shadow DOM недоступны.</p>}
    {!!data?.unavailableFrames && <p>Недоступных фреймов: {data.unavailableFrames}. Возможно, запрещён доступ к сайту или требуется обновить страницу.</p>}
    {error && <p role="alert">{error}</p>}
    {room?.error && room.error !== error && <p role="alert">{room.error}</p>}
  </section>
}
