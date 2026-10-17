import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { RoomCommand, RoomView, SharedState } from "../lib/room-protocol"
import type { TabVideos } from "../lib/video"
import { LoadingStatus } from "./loading-status"

const labels: Record<RoomView["status"], string> = {
  idle: "Не в комнате", waiting: "Ожидание участников", connected: "Подключено",
  reconnecting: "Ожидание администратора", error: "Ошибка соединения"
}
export function RoomPanel() {
  const [room, setRoom] = useState<RoomView>()
  const [invitation, setInvitation] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const request = (command: RoomCommand) => sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command })
  useEffect(() => {
    let active = true
    const poll = () => void request({ kind: "status" }).then(view => { if (active) setRoom(view) }, cause => { if (active) setError(String(cause)) })
    poll()
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  async function perform(command: RoomCommand) {
    setBusy(true)
    setError("")
    setCopied(false)
    try { setRoom(await request(command)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка комнаты") }
    finally { setBusy(false) }
  }
  async function create() {
    setBusy(true)
    setError("")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      let initial: SharedState | undefined
      if (tab?.id !== undefined) {
        const videos = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: tab.id })
        const selected = videos.frames.flatMap(frame => frame.snapshot.videos.filter(video => video.id === frame.snapshot.selectedId))[0]
        if (selected) initial = { url: selected.descriptor.pageUrl, video: selected.descriptor, playback: { position: selected.position, paused: selected.paused, rate: selected.playbackRate } }
      }
      setRoom(await request({ kind: "create", initial }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать комнату") }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(room!.invitation!); setCopied(true) }
    catch { setError("Не удалось скопировать. Выдели приглашение и скопируй вручную.") }
  }
  return <section style={{ borderBottom: "1px solid #ddd", paddingBottom: 16 }}>
    <h3>Комната</h3>
    {!room || busy ? <LoadingStatus>{!room ? "Загружаем комнату…" : "Подождите…"}</LoadingStatus> :
      room.status !== "idle" && !room.ready && room.status === "waiting" ?
        <LoadingStatus>Подключаемся к комнате…</LoadingStatus> :
        <p role="status">{labels[room.status]}</p>}
    {room?.status === "idle" && !busy ? <>
      <button disabled={busy} onClick={create}>Создать комнату</button>
      <p><label>Приглашение<textarea value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="wtg2.…" style={{ width: "100%", boxSizing: "border-box" }} /></label></p>
      <button disabled={busy || !invitation.trim()} onClick={() => void perform({ kind: "join", invitation })}>Присоединиться</button>
    </> : room && room.status !== "idle" && <>
      {room.ready && <>
      <p>Участники: {room.participants.length}</p>
      <ul>{room.participants.map(id => <li key={id}>{id.slice(0, 8)}{id === room.selfId ? " · ты" : ""}{id === room.adminId ? " · админ" : ""}</li>)}</ul>
      <textarea aria-label="Приглашение комнаты" readOnly value={room.invitation || ""} style={{ width: "100%", boxSizing: "border-box" }} />
      <button onClick={copy}>{copied ? "Скопировано" : "Поделиться комнатой"}</button>{" "}
      </>}
      <button disabled={busy} onClick={() => void perform({ kind: "leave" })}>Выйти</button>
      {room.isAdmin && <button disabled={busy} onClick={() => void perform({ kind: "end" })}>Завершить комнату</button>}
      {(room.status === "error" || room.status === "reconnecting" || room.status === "waiting") && <p><button disabled={busy} onClick={() => void perform({ kind: "retry" })}>Повторить подключение</button></p>}
      {room.ready && room.shared.url && <p>Источник комнаты: {room.shared.url}</p>}
      {room.ready && <small>Сейчас подключаются участники и передаётся начальное состояние. Управление просмотром — следующий этап.</small>}
    </>}
    {(error || room?.error) && <p role="alert">{error || room?.error}</p>}
  </section>
}
