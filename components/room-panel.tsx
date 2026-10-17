import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { RoomCommand, RoomView, SharedState } from "../lib/room-protocol"
import type { TabVideos } from "../lib/video"
import { LoadingStatus } from "./loading-status"
import { SourceControls } from "./source-controls"
import { VideoPicker } from "./video-picker"
import { GroupPlayerStatus } from "./group-player-status"

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
  const [copyFailed, setCopyFailed] = useState(false)
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
    try { await navigator.clipboard.writeText(room!.invitation!); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true); setError("Не удалось скопировать. Скопируй приглашение из поля ниже.") }
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
      <GroupPlayerStatus room={room} busy={busy} remove={id => void perform({ kind: "remove", peerId: id })} />
      {room.isAdmin && room.approvalRequired && <p>Новые участники входят после твоего подтверждения.</p>}
      {room.isAdmin && room.pendingParticipants.length > 0 && <div>
        <h4>Ожидают допуска</h4>
        <ul>{room.pendingParticipants.map(member => <li key={member.peerId}>{member.peerId.slice(0, 8)}{" "}
          <button disabled={busy} onClick={() => void perform({ kind: "approve", peerId: member.peerId })}>Разрешить вход</button>
        </li>)}</ul>
      </div>}
      {room.isAdmin && room.blockedKeys.length > 0 && <section>
        <h4>Удалённые участники ({room.blockedKeys.length})</h4>
        <ul>{room.blockedKeys.map(key => <li key={key}>{key.slice(0, 12)}{" "}
          <button disabled={busy} onClick={() => void perform({ kind: "readmit", publicKey: key })}>Разрешить снова</button>
        </li>)}</ul>
      </section>}
      {copyFailed && <textarea aria-label="Приглашение комнаты" readOnly value={room.invitation || ""} style={{ width: "100%", boxSizing: "border-box" }} />}
      <button onClick={copy}>{copied ? "Скопировано" : "Пригласить"}</button>{" "}
      </>}
      <div style={{ marginTop: 8 }}>
      <button disabled={busy} onClick={() => void perform({ kind: "leave" })}>Выйти</button>
      {room.isAdmin && <button disabled={busy} onClick={() => { if (window.confirm("Завершить комнату для всех?")) void perform({ kind: "end" }) }}>Завершить комнату</button>}
      </div>
      {(room.status === "error" || room.status === "reconnecting") && <p><button disabled={busy} onClick={() => void perform({ kind: "retry" })}>Повторить подключение</button></p>}
      {room.ready && <SourceControls room={room} />}
      {room.ready && <VideoPicker />}
      {room.ready && <details><summary>Диагностика синхронизации</summary>
        <p>{room.sync?.preparation ? "Подготовка общего запуска" : room.sync?.command ? room.sync.command.paused ? "Общая пауза" : "Общий таймлайн воспроизведения" : "Ожидаем команды плеера"}</p>
        {room.sync?.clock && <p>RTT {Math.round(room.sync.clock.rtt)} мс · неопределённость ±{Math.round(room.sync.clock.uncertainty)} мс</p>}
      </details>}
    </>}
    {(error || room?.error) && <p role="alert">{error || room?.error}</p>}
  </section>
}
