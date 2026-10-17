import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos, VideoAction, VideoDescriptor, VideoSnapshot } from "../lib/video"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
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
  let roomId = ""
  try { if (room?.invitation) roomId = decodeInvitation(room.invitation).roomId } catch {}
  const locallyBound = (frame: TabVideos["frames"][number], id?: string) => !!room?.ready &&
    frame.snapshot.roomBinding?.roomId === roomId && frame.snapshot.roomBinding?.revision === sourceRevision(room.shared) &&
    frame.snapshot.binding === "bound" && frame.snapshot.selectedId === frame.snapshot.roomBinding.videoId && (!id || id === frame.snapshot.roomBinding.videoId)
  return <section>
    <h4>{room?.shared.video ? "Видео выбрано для группы" : "Выбери видео для группы"}</h4>
    {room?.shared.video && <p>{data?.frames.flatMap(frame => frame.snapshot.videos).find(video => sameVideoSelection(video.descriptor, room.shared.video))?.label || "Общий плеер"} · {data?.frames.some(frame => locallyBound(frame)) ? "✓ Привязан у тебя" : "Привязка на этой странице не подтверждена"}</p>}
    {pending && <p role="status">⏳ Применяем выбор для комнаты…</p>}
    {!pending && notice && <p role="status">{notice}</p>}
    <div>
    <p>Доступные плееры ({count})</p>
    <button disabled={busy || !data?.frames.length} onClick={pick}>Указать мой плеер</button>
    <p>Локальная привязка: наведи на плеер и нажми. Escape — отмена. Затем открой расширение снова; общий выбор меняется кнопкой «Выбрать для всех».</p>
    {data?.frames.map(frame => <div key={frame.frameId}>
      {!locallyBound(frame) && frame.snapshot.notice && <p role="status">{frame.snapshot.notice}</p>}
      {!locallyBound(frame) && (frame.snapshot.binding === "missing" || frame.snapshot.binding === "ambiguous") ? <p role="status">Привязка на этой странице потеряна. Выбери плеер у себя.</p> : null}
      {frame.snapshot.videos.map(video => <article key={video.id}
        onMouseEnter={() => void action(frame.frameId, { kind: "highlight", id: video.id })}
        onMouseLeave={() => void action(frame.frameId, { kind: "highlight", id: null })}
        style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: 10, marginTop: 8 }}>
        {room?.ready && sameVideoSelection(video.descriptor, room.shared.video) && <p style={{ color: "#334155", fontWeight: 600 }}>Выбор группы</p>}
        {locallyBound(frame, video.id) ? <p style={{ color: "#166534", fontWeight: 700 }}>✓ Привязан у тебя</p> : frame.snapshot.selectedId === video.id ? <p>Выбран локально · привязка к группе не подтверждена</p> : null}
        {video.poster && <img src={video.poster} alt="" referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: 100 }} />}
        <strong>{video.label}</strong>
          <details>
            <summary>Диагностика локального селектора</summary>
            <code>{video.descriptor.selector}</code>
            {!!video.descriptor.shadowPath.length && <p><small>Shadow DOM: </small><code>{video.descriptor.shadowPath.join(" → ")}</code></p>}
          </details>
        <p>{video.width}×{video.height} · {video.duration === null ? "Длительность неизвестна / live" : `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`} · {video.readyState < 2 ? "Загружается" : video.paused ? "Пауза" : "Играет"}</p>
        <small>{frame.frameId === 0 ? "Основная страница" : `Фрейм: ${frame.url}`}</small><br />
        {room?.shared.video && !data?.frames.some(f => locallyBound(f)) && <p><button onClick={() => void action(frame.frameId, { kind: "select", id: video.id })}>Это мой плеер</button><br /><small>Только локальная привязка, без смены видео группы.</small></p>}
        <button disabled={busy || !!pending || !room?.ready} onClick={() => void share(video)}>{pending && sameVideoSelection(pending.video, video.descriptor) ? "Применяем выбор…" : "Выбрать для всех"}</button>
      </article>)}
    </div>)}
    {data && !count && <p>Доступные видео не найдены. Запусти плеер или обнови страницу. Закрытые Shadow DOM недоступны.</p>}
    </div>
    <details><summary>Диагностика плеера</summary>
      <button onClick={() => void refresh()}>Обновить список</button>
      {room?.shared.video && <div style={{ overflowWrap: "anywhere" }}>
        <p>Общий CSS-селектор · ревизия {sourceRevision(room.shared)}: <code>{room.shared.video.selector}</code></p>
        <p>Shadow DOM: <code>{room.shared.video.shadowPath.join(" → ") || "нет"}</code></p>
        <p>Фрейм: {room.shared.video.frameUrl}</p>
        <p>Путь фреймов (URL): {room.shared.video.framePath.join(" → ") || "Основная страница"}</p>
      </div>}
      <p>Недоступных фреймов: {data?.unavailableFrames ?? "—"}.</p>
    </details>
    {error && <p role="alert">{error}</p>}
    {room?.error && room.error !== error && <p role="alert">{room.error}</p>}
  </section>
}
