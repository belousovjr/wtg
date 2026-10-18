import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import { decodeInvitation, type RoomView } from "../lib/room-protocol"
import { samePageLocation } from "../lib/source"
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
  return <section>
    <h4>Просмотр</h4>
    {room.shared.url && <p style={{ overflowWrap: "anywhere" }}>{room.shared.url}</p>}
    {!room.shared.url && <p>Открой нужную страницу и выбери плеер кнопкой «Выбрать для всех» — его URL передастся вместе с видео.</p>}
    {room.shared.url && <>
      {!room.shared.video && <p>Страница задана. Теперь выбери видео для группы в списке ниже.</p>}
      {room.sourceReadiness[room.selfId]?.status === "unavailable" && <p>Вкладка просмотра не привязана, закрыта или плеер недоступен.</p>}
      {!isViewingTab && hasViewingTab && <button disabled={tabBusy} onClick={() => void tabAction("source-focus")}>К вкладке просмотра</button>}
      {wrongUrl && <button disabled={tabBusy} onClick={() => void tabAction("source-open-url")}>Открыть страницу просмотра</button>}
      {!hasViewingTab ? <button disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Смотреть в этой вкладке</button> : !isViewingTab && <div>
        <p>Текущая вкладка станет вкладкой просмотра и откроет общий URL.</p>
        <button disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Перенести в эту вкладку</button>
      </div>}
    </>}
    {tabError && <p role="alert">{tabError}</p>}
  </section>
}
