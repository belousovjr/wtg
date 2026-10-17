import { useState } from "react"
import { CHANNEL, sendRequest, type RuntimeStatus, type FrameStatus } from "./lib/messages"

function IndexPopup() {
  const [status, setStatus] = useState<RuntimeStatus>()
  const [page, setPage] = useState<FrameStatus>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    setError("")
    setPage(undefined)
    try {
      setStatus(await sendRequest<RuntimeStatus>({ channel: CHANNEL, to: "background", type: "runtime-status" }))
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id === undefined) throw new Error("Активная вкладка не найдена")
      setPage(await sendRequest<FrameStatus>({ channel: CHANNEL, to: "background", type: "frame-status", target: { tabId: tab.id, frameId: 0 } }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка расширения")
    } finally { setBusy(false) }
  }

  return (
    <div
      style={{
        padding: 16, width: 340, fontFamily: "system-ui", overflowWrap: "anywhere"
      }}>
      <h2>Watch Together</h2>
      <p>Основа расширения. Комнаты и выбор видео — следующие этапы.</p>
      <button disabled={busy} onClick={check}>{busy ? "Проверяем…" : "Проверить подключение к странице"}</button>
      {status && <div>
        <p>WebRTC: {status.webRtcAvailable ? "доступен" : "недоступен"}</p>
        <p>Контекст: {status.instanceId}</p>
        <p>Запущен: {new Date(status.startedAt).toLocaleTimeString()}</p>
      </div>}
      {page && <p>Страница отвечает: {page.title || page.url}</p>}
      {error && <p role="alert">{error}. Для обычной страницы попробуй обновить вкладку.</p>}
    </div>
  )
}

export default IndexPopup
