import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { TabVideos, VideoAction, VideoSnapshot } from "../lib/video"

export function VideoPicker() {
  const [tabId, setTabId] = useState<number>()
  const [data, setData] = useState<TabVideos>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function refresh(id = tabId) {
    if (id === undefined) return
    try {
      const result = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: id })
      setData(result)
      setError("")
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
  const count = data?.frames.reduce((sum, frame) => sum + frame.snapshot.videos.length, 0) || 0
  return <section>
    <h3>Видео на странице ({count})</h3>
    <button disabled={busy || !data?.frames.length} onClick={pick}>Выбрать на странице</button>{" "}
    <button onClick={() => void refresh()}>Обновить</button>
    <p>Наведи на плеер и нажми. Escape — отмена. После выбора открой расширение снова.</p>
    {data?.frames.map(frame => <div key={frame.frameId}>
      {frame.snapshot.binding === "missing" || frame.snapshot.binding === "ambiguous" ? <p role="status">Привязка потеряна или неоднозначна. Выбери видео заново.</p> : null}
      {frame.snapshot.videos.map(video => <article key={video.id}
        onMouseEnter={() => void action(frame.frameId, { kind: "highlight", id: video.id })}
        onMouseLeave={() => void action(frame.frameId, { kind: "highlight", id: null })}
        style={{ border: "1px solid #ccc", borderRadius: 8, padding: 10, marginTop: 8 }}>
        {video.poster && <img src={video.poster} alt="" referrerPolicy="no-referrer" style={{ maxWidth: "100%", maxHeight: 100 }} />}
        <strong>{video.label}</strong>
        <p>{video.width}×{video.height} · {video.duration === null ? "Длительность неизвестна / live" : `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`} · {video.readyState < 2 ? "Загружается" : video.paused ? "Пауза" : "Играет"}</p>
        <small>{frame.frameId === 0 ? "Основная страница" : `Фрейм: ${frame.url}`}</small><br />
        <button onClick={() => void action(frame.frameId, { kind: "select", id: video.id })}>{frame.snapshot.selectedId === video.id ? "✓ Выбрано" : "Выбрать"}</button>
      </article>)}
    </div>)}
    {data && !count && <p>Доступные видео не найдены. Запусти плеер или обнови страницу. Закрытые Shadow DOM недоступны.</p>}
    {!!data?.unavailableFrames && <p>Недоступных фреймов: {data.unavailableFrames}. Возможно, запрещён доступ к сайту или требуется обновить страницу.</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
