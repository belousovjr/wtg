import { t } from "./i18n"
import { now, type PlaybackLocal } from "./playback"

export function indicatorState(playback: PlaybackLocal, revision: number, locallyBlocked = false) {
  if (locallyBlocked) return { ready: false, urgent: true, text: t("playerIndicator.pressPlay") }
  const ids = playback.participantIds || []
  const command = playback.command
  const reports = ids.map(id => ({ id, report: playback.players[id] })).filter(({ report }) => report?.epoch === playback.epoch && report.revision === revision &&
    (playback.preparation ? report.preparationId === playback.preparation.id : !!command && report.sequence === command.sequence))
  const blocked = reports.filter(({ id, report }) => id !== playback.selfId && report.status === "blocked").length
  if (blocked) return { ready: false, text: t("playerIndicator.blockedCount", { count: blocked }) }
  if (reports.some(({ report }) => report.status === "error" || report.status === "missing")) return { ready: false, text: t("playerIndicator.playerProblem") }
  if (!playback.clock) return { ready: false, text: t("playerIndicator.clock") }
  if (playback.preparation) return { ready: false, text: t("playerIndicator.preparing") }
  if (!command) return { ready: false, text: t("playerIndicator.waitingCommand") }
  if (now() + playback.clock.offset < command.executeAt) return { ready: false, text: t("playerIndicator.waitingStart") }
  const ready = reports.filter(({ report }) => report.status === "ready").length
  return ids.length > 0 && ready === ids.length
    ? { ready: true, text: t("playerIndicator.ready") }
    : { ready: false, text: t("playerIndicator.waitingParticipants", { ready: ready, total: ids.length || "?" }) }
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
      this.adminNode.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;height:28px;padding:0 9px;border-radius:7px;background:rgba(20,24,30,.72);color:#ea4c89;font:500 11px/28px system-ui;font-variant-numeric:tabular-nums;box-sizing:border-box;backdrop-filter:blur(6px)"
    }
    const host = document.fullscreenElement && !(document.fullscreenElement instanceof HTMLVideoElement) ? document.fullscreenElement : document.documentElement
    if (this.adminNode.parentElement !== host) host.append(this.adminNode)
    const rect = video.getBoundingClientRect()
    this.adminNode.style.right = `${Math.max(10, window.innerWidth - rect.right + 44)}px`
    this.adminNode.style.top = `${Math.max(10, rect.top + 10)}px`
    this.adminNode.style.display = rect.width && rect.height ? "block" : "none"
    const label = `${summary.synchronized}/${summary.total}`
    this.adminNode.title = t("playerIndicator.synchronizationCount", { ready: summary.synchronized, total: summary.total })
    this.adminNode.setAttribute("aria-label", this.adminNode.title)
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
      this.node.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;max-width:240px;background-color:rgba(20,24,30,.72);color:#ea4c89;font:500 11px/1.4 system-ui;box-sizing:border-box;backdrop-filter:blur(6px);background-repeat:no-repeat;background-position:center;background-size:14px"
    }
    const host = document.fullscreenElement && !(document.fullscreenElement instanceof HTMLVideoElement) ? document.fullscreenElement : document.documentElement
    if (this.node.parentElement !== host) host.append(this.node)
    const rect = video.getBoundingClientRect()
    this.node.style.right = `${Math.max(10, window.innerWidth - rect.right + 10)}px`
    this.node.style.top = `${Math.max(10, rect.top + 10)}px`
    this.node.style.display = rect.width && rect.height ? "block" : "none"
    const text = ready ? t("playerIndicator.ready") : state.urgent ? state.text :
      pending || awaitingAction ? t("playerIndicator.awaitingCommand") :
      starting ? t("playerIndicator.starting") : video.seeking ? t("playerIndicator.seeking") : state.text
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
    const visibleText = actionable ? t("video.pressPlay") : ""
    if (this.node.textContent !== visibleText) this.node.textContent = visibleText
    const icon = ready ? '<path d="m5 12 4 4L19 6"/>' : '<path d="M20 12a8 8 0 1 1-8-8"/>'
    this.node.style.backgroundImage = actionable ? "none" : `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ea4c89" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`)}")`
    if (this.adminNode) this.adminNode.style.top = `${Math.max(10, rect.top + (actionable ? 46 : 10))}px`
    this.node.setAttribute("aria-label", ready ? t("playerIndicator.groupReady") : text)
    this.node.title = ready ? t("playerIndicator.done") : actionable ? text : t("playerIndicator.synchronizing")
    this.node.style.borderRadius = actionable ? "7px" : "50%"
    this.node.style.padding = actionable ? "6px 9px" : "0"
    this.node.style.width = actionable ? "auto" : "28px"
    this.node.style.height = actionable ? "auto" : "28px"
    this.node.style.textAlign = "center"
    this.node.style.fontSize = "11px"
    this.node.style.lineHeight = actionable ? "1.4" : "28px"
    if (!ready && !actionable) {
      if (!this.spinner && this.node.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
        this.spinner = this.node.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 1000, iterations: Infinity })
    } else { this.spinner?.cancel(); this.spinner = undefined }
    this.node.style.color = "#ea4c89"
  }
}
