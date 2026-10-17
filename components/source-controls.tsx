import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import { decodeInvitation, type RoomCommand, type RoomView } from "../lib/room-protocol"
import { sourceRevision } from "../lib/source"
export function SourceControls({ room, perform, busy }: { room: RoomView; perform: (command: RoomCommand) => Promise<void>; busy: boolean }) {
  const [url, setUrl] = useState(room.shared.url || "")
  const [tabError, setTabError] = useState("")
  const [tabBusy, setTabBusy] = useState(false)
  const [isViewingTab, setIsViewingTab] = useState(false)
  const [hasViewingTab, setHasViewingTab] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const [stored, tabs] = await Promise.all([chrome.storage.session.get("sourceViewer"), chrome.tabs.query({ active: true, currentWindow: true })])
      const viewer = stored.sourceViewer
      if (!active) return
      const belongs = !!room.invitation && viewer?.roomId === decodeInvitation(room.invitation).roomId
      setHasViewingTab(belongs && !!viewer?.boundByUser && !viewer.closed)
      setIsViewingTab(belongs && !!viewer?.boundByUser && !viewer.closed && viewer.tabId === tabs[0]?.id)
    }
    void refresh().catch(() => {})
    const timer = setInterval(() => void refresh().catch(() => {}), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [room.invitation])
  async function tabAction(type: "source-focus" | "source-attach") {
    setTabBusy(true)
    setTabError("")
    try {
      const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type })
      if (!reply?.ok) throw new Error(reply?.error || "Вкладка просмотра недоступна")
    } catch (error) { setTabError(error instanceof Error ? error.message : "Вкладка просмотра недоступна") }
    finally { setTabBusy(false) }
  }
  useEffect(() => { setUrl(room.shared.url || "") }, [room.shared.url])
  return <section>
    <h4>Просмотр</h4>
    {room.shared.url && <p style={{ overflowWrap: "anywhere" }}>{room.shared.url}</p>}
    <details open={!room.shared.url}><summary>{room.shared.url ? "Сменить страницу" : "Выбрать страницу"}</summary>
    <form onSubmit={event => {
      event.preventDefault()
      void perform({ kind: "source", url, video: null, expectedRevision: sourceRevision(room.shared), commandId: crypto.randomUUID() })
    }}>
      <label>Общий URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" style={{ width: "100%", boxSizing: "border-box" }} /></label>
      <button disabled={busy || !room.ready || url === room.shared.url}>Открыть у всех</button>
    </form>
    </details>
    {room.shared.url && <>
      {!room.shared.video && <p>Страница задана. Теперь выбери видео для группы в списке ниже.</p>}
      {room.sourceReadiness[room.selfId]?.status === "unavailable" && <p>Вкладка просмотра не привязана, закрыта или плеер недоступен.</p>}
      {!isViewingTab && hasViewingTab && <button disabled={tabBusy} onClick={() => void tabAction("source-focus")}>К вкладке просмотра</button>}
      {!hasViewingTab ? <button disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Смотреть в этой вкладке</button> : !isViewingTab && <details><summary>Перенести просмотр сюда</summary>
        <p>Текущая вкладка станет вкладкой просмотра и откроет общий URL.</p>
        <button disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Перенести в эту вкладку</button>
      </details>}
    </>}
    {tabError && <p role="alert">{tabError}</p>}
  </section>
}
