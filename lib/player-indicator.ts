import { now, type PlaybackLocal } from "./playback"

export function indicatorState(playback: PlaybackLocal, revision: number, locallyBlocked = false) {
  if (locallyBlocked) return { ready: false, urgent: true, text: "▶ Нажми Play на плеере" }
  const ids = playback.participantIds || []
  const command = playback.command
  const reports = ids.map(id => ({ id, report: playback.players[id] })).filter(({ report }) => report?.epoch === playback.epoch && report.revision === revision &&
    (playback.preparation ? report.preparationId === playback.preparation.id : !!command && report.sequence === command.sequence))
  const blocked = reports.filter(({ id, report }) => id !== playback.selfId && report.status === "blocked").length
  if (blocked) return { ready: false, text: `Ждём ручного запуска у участников: ${blocked}` }
  if (reports.some(({ report }) => report.status === "error" || report.status === "missing")) return { ready: false, text: "У участника проблема с плеером" }
  if (!playback.clock) return { ready: false, text: "◌ Согласуем часы…" }
  if (playback.preparation) return { ready: false, text: "◌ Подготавливаем плееры…" }
  if (!command) return { ready: false, text: "Ожидание команды просмотра" }
  if (now() + playback.clock.offset < command.executeAt) return { ready: false, text: "◌ Ждём общего старта…" }
  const ready = reports.filter(({ report }) => report.status === "ready").length
  return ids.length > 0 && ready === ids.length
    ? { ready: true, text: "✓ Группа готова" }
    : { ready: false, text: `Ждём синхронизации участников · готовы ${ready}/${ids.length || "?"}` }
}

export class PlayerIndicator {
  private node?: HTMLDivElement
  private operation = false
  private commandId?: string
  private acknowledged = false
  private settledAt?: number
  private lastDiagnostic = ""
  private spinner?: Animation
  private adminNode?: HTMLDivElement
  private updateAdmin(video: HTMLVideoElement, playback: PlaybackLocal) {
    const summary = playback.adminSync
    if (!summary || summary.total === 0 || summary.synchronized === summary.total) {
      this.adminNode?.remove(); this.adminNode = undefined; return
    }
    if (!this.adminNode) {
      this.adminNode = document.createElement("div")
      this.adminNode.setAttribute("role", "status")
      this.adminNode.setAttribute("aria-live", "polite")
      this.adminNode.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;padding:7px 10px;border-radius:8px;background:rgba(15,23,42,.94);color:#fde68a;font:600 12px/1.4 system-ui;box-sizing:border-box;max-width:280px"
    }
    const host = document.fullscreenElement && !(document.fullscreenElement instanceof HTMLVideoElement) ? document.fullscreenElement : document.documentElement
    if (this.adminNode.parentElement !== host) host.append(this.adminNode)
    const rect = video.getBoundingClientRect()
    this.adminNode.style.left = `${Math.max(4, Math.min(rect.right - 292, window.innerWidth - 292))}px`
    this.adminNode.style.top = `${Math.max(4, rect.top + 62)}px`
    this.adminNode.style.display = rect.width && rect.height ? "block" : "none"
    const label = `Синхронизированы ${summary.synchronized} / ${summary.total} участников`
    if (this.adminNode.textContent !== label) this.adminNode.textContent = label
  }
  begin(commandId?: string) {
    this.operation = true; this.commandId = commandId; this.acknowledged = false; this.settledAt = undefined
  }
  clear() { this.spinner?.cancel(); this.spinner = undefined; this.node?.remove(); this.node = undefined; this.adminNode?.remove(); this.adminNode = undefined; this.operation = false; this.commandId = undefined; this.settledAt = undefined; this.acknowledged = false }
  update(video: HTMLVideoElement | undefined, playback: PlaybackLocal, revision: number, pending: boolean, locallyBlocked = false, starting = false) {
    if (typeof document === "undefined") return
    if (!video?.isConnected) { this.node?.remove(); this.node = undefined; this.adminNode?.remove(); this.adminNode = undefined; return }
    this.updateAdmin(video, playback)
    if (this.commandId && (playback.command?.commandId === this.commandId || playback.preparation?.commandId === this.commandId)) this.acknowledged = true
    const state = indicatorState(playback, revision, locallyBlocked)
    const idle = !this.operation && !pending && !starting && !playback.preparation &&
      (!playback.command || playback.command.paused)
    if (idle && !state.urgent) {
      this.spinner?.cancel(); this.spinner = undefined
      this.node?.remove(); this.node = undefined
      return
    }
    const loading = video.seeking || video.readyState < 2
    const awaitingAction = !!this.operation && (!this.commandId || !this.acknowledged)
    const ready = state.ready && !pending && !loading && !awaitingAction &&
      (!playback.adminSync || playback.adminSync.synchronized === playback.adminSync.total)
    if (ready) {
      if (!this.operation) { this.node?.remove(); this.node = undefined; return }
      this.settledAt ??= now()
      if (now() - this.settledAt > 1200) { this.clear(); return }
    } else this.settledAt = undefined
    if (!this.node) {
      this.node = document.createElement("div")
      this.node.setAttribute("role", "status")
      this.node.setAttribute("aria-live", "polite")
      this.node.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;max-width:280px;padding:9px 12px;border-radius:9px;background:rgba(15,23,42,.94);color:white;font:600 13px/1.4 system-ui;box-shadow:0 2px 12px #0006;box-sizing:border-box"
    }
    const host = document.fullscreenElement && !(document.fullscreenElement instanceof HTMLVideoElement) ? document.fullscreenElement : document.documentElement
    if (this.node.parentElement !== host) host.append(this.node)
    const rect = video.getBoundingClientRect()
    this.node.style.left = `${Math.max(4, Math.min(rect.right - 292, window.innerWidth - 292))}px`
    this.node.style.top = `${Math.max(4, rect.top + 12)}px`
    this.node.style.display = rect.width && rect.height ? "block" : "none"
    const text = ready ? "✓ Группа готова" : state.urgent ? state.text :
      pending || awaitingAction ? "◌ Ждём подтверждения команды…" :
      starting ? "◌ Запускаем воспроизведение…" : video.seeking ? "◌ Загружаем выбранную позицию…" : state.text
    const actionable = !ready && !!state.urgent
    const label = ready ? "✓" : actionable ? text : "◌"
    const diagnostic = JSON.stringify({ label, paused: video.paused, seeking: video.seeking, readyState: video.readyState,
      pending, awaitingAction, starting, locallyBlocked, clockReady: !!playback.clock,
      preparation: !!playback.preparation, commandPaused: playback.command?.paused,
      localStatus: playback.selfId ? playback.players[playback.selfId]?.status : undefined })
    if (diagnostic !== this.lastDiagnostic) {
      this.lastDiagnostic = diagnostic
      console.info("[WTG indicator]", diagnostic)
    }
    if (this.node.textContent !== label) this.node.textContent = label
    this.node.setAttribute("aria-label", ready ? "Группа готова" : text)
    this.node.title = ready ? "Готово" : actionable ? text : "Синхронизация"
    this.node.style.borderRadius = actionable ? "9px" : "50%"
    this.node.style.padding = actionable ? "9px 12px" : "8px"
    this.node.style.width = actionable ? "auto" : "36px"
    this.node.style.height = actionable ? "auto" : "36px"
    this.node.style.textAlign = "center"
    this.node.style.fontSize = actionable ? "13px" : "20px"
    this.node.style.lineHeight = actionable ? "1.4" : "20px"
    if (!ready && !actionable) {
      if (!this.spinner && this.node.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
        this.spinner = this.node.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 1000, iterations: Infinity })
    } else { this.spinner?.cancel(); this.spinner = undefined }
    this.node.style.color = ready ? "#86efac" : "#fde68a"
  }
}
