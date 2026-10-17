import { now, positionAt, validCommit, validPreparation, type PlaybackLocal, type PlaybackRequest, type PlayerReport } from "./playback"

type EventMessage = { kind: "request"; request: PlaybackRequest } | { kind: "report"; report: PlayerReport }
export class PlayerSync {
  private context?: { roomId: string; revision: number; playback: PlaybackLocal }
  private video?: HTMLVideoElement
  private timer?: ReturnType<typeof setTimeout>
  private seekTimer?: ReturnType<typeof setTimeout>
  private applied = ""
  private scheduled = ""
  private prepared = ""
  private expectedPaused = true
  private expectedPosition = 0
  private remoteSeekUntil = 0
  private expectedRate = 1
  private overlay?: HTMLDivElement
  private lastReport = ""
  constructor(private getVideo: () => HTMLVideoElement | undefined, private send: (roomId: string, revision: number, message: EventMessage) => void) {}
  bind() {
    const video = this.getVideo()
    if (video === this.video) return
    clearTimeout(this.seekTimer)
    if (this.video) { this.expectedPaused = true; this.video.pause() }
    for (const name of ["play", "pause", "seeking", "seeked", "ratechange", "canplay", "loadedmetadata"]) this.video?.removeEventListener(name, this.onEvent)
    this.video = video; this.applied = ""; this.prepared = ""; this.scheduled = ""
    clearTimeout(this.timer)
    this.remoteSeekUntil = 0
    for (const name of ["play", "pause", "seeking", "seeked", "ratechange", "canplay", "loadedmetadata"]) video?.addEventListener(name, this.onEvent)
    console.info("[WTG seek] Обработчики плеера", { attached: !!video, connected: !!video?.isConnected, activeContext: !!this.context })
    this.lastReport = ""
    if (!video) this.report("missing", "Плеер не найден")
  }
  update(roomId: string, revision: number, playback: PlaybackLocal | null) {
    if (!playback) {
      this.context = undefined; clearTimeout(this.timer); clearTimeout(this.seekTimer)
      this.expectedPaused = true; this.video?.pause(); this.overlay?.remove(); this.overlay = undefined
      this.applied = ""; this.scheduled = ""; this.prepared = ""; this.lastReport = ""
      return
    }
    if (this.context?.playback.epoch === playback.epoch && this.context.revision === revision && playback.command && this.context.playback.command && playback.command.sequence < this.context.playback.command.sequence) return
    if (playback.command && !validCommit(playback.command) || playback.preparation && !validPreparation(playback.preparation)) return
    if (this.context?.roomId !== roomId || this.context.revision !== revision || this.context.playback.epoch !== playback.epoch) {
      clearTimeout(this.timer); clearTimeout(this.seekTimer)
      this.applied = ""; this.scheduled = ""; this.prepared = ""; this.lastReport = ""
      this.expectedPaused = true
      this.overlay?.remove(); this.overlay = undefined
    }
    this.context = { roomId, revision, playback }
    this.bind()
    const video = this.video
    if (!video?.isConnected) { this.report("missing", "Плеер не найден"); return }
    const prep = playback.preparation
    if (prep && prep.revision === revision) {
      clearTimeout(this.timer); this.scheduled = ""
      this.expectedPaused = true; video.pause()
      if (!this.seek(prep.position, prep.rate)) return
      this.prepared = prep.id
      this.report(video.seeking || video.readyState < 2 ? "loading" : "ready")
      return
    }
    const command = playback.command
    if (!command) { this.expectedPaused = true; video.pause(); return }
    if (command.revision !== revision) return
    const id = `${command.epoch}:${command.sequence}`
    if (this.applied === id || this.scheduled === id) return
    if (!playback.clock) { this.report("loading", "Согласуем часы"); return }
    this.scheduled = id
    clearTimeout(this.timer)
    const execute = () => {
      this.scheduled = ""
      if (this.context?.playback.command?.sequence !== command.sequence || this.context.playback.epoch !== command.epoch || this.context.playback.preparation) return
      const coordinatorTime = now() + this.context.playback.clock!.offset
      if (!this.seek(positionAt(command, coordinatorTime), command.rate)) return
      this.expectedPaused = command.paused
      this.applied = id
      const late = Math.max(0, coordinatorTime - command.executeAt)
      if (command.paused) { video.pause(); this.overlay?.remove(); this.overlay = undefined; this.report("ready", undefined, late) }
      else void video.play().then(() => {
        if (this.context?.playback.command?.sequence === command.sequence && this.context.playback.epoch === command.epoch && !this.context.playback.preparation) this.report("ready", undefined, late)
      }, error => {
        if (this.context?.playback.command?.sequence !== command.sequence || this.context.playback.epoch !== command.epoch || this.context.playback.preparation) return
        this.report(error?.name === "NotAllowedError" ? "blocked" : "error", error?.name === "NotAllowedError" ? "Нажми «Разрешить воспроизведение» на странице" : "Браузер не смог запустить видео")
        if (error?.name === "NotAllowedError") this.showUnlock()
      })
    }
    this.timer = setTimeout(execute, Math.max(0, command.executeAt - playback.clock.offset - now()))
  }
  private seek(position: number, rate: number) {
    const video = this.video!
    if (video.readyState < 1) { this.report("loading", "Ждём metadata видео"); return false }
    if (!Number.isFinite(video.duration)) { this.report("error", "Трансляции пока не поддерживаются"); return false }
    const target = Math.min(position, Math.max(0, video.duration - 0.05))
    let available = target < 0.1
    for (let i = 0; i < video.seekable.length; i++) if (target >= video.seekable.start(i) && target <= video.seekable.end(i)) available = true
    if (!available) { this.report("loading", "Ожидаем доступность позиции"); return false }
    try {
      this.expectedPosition = target; this.expectedRate = rate
      video.playbackRate = rate
      if (Math.abs(video.currentTime - target) > 0.15) { this.remoteSeekUntil = now() + 1000; video.currentTime = target }
      return true
    } catch { this.report("error", "Плеер не разрешает перемотку"); return false }
  }
  private report(status: PlayerReport["status"], detail?: string, lateness?: number) {
    const context = this.context
    if (!context) return
    const p = context.playback
    const report: PlayerReport = { epoch: p.epoch, revision: context.revision, ...(p.preparation ? { preparationId: p.preparation.id } : { sequence: p.command?.sequence }), status, detail, lateness }
    const key = JSON.stringify([report.epoch, report.revision, report.preparationId, report.sequence, status, detail])
    if (key === this.lastReport) return
    this.lastReport = key
    this.send(context.roomId, context.revision, { kind: "report", report })
  }
  private onEvent = (event: Event) => {
    const c = this.context, video = this.video
    if ((event.type === "seeking" || event.type === "seeked") && video && event.target === video)
      console.info(`[WTG seek] ${event.type} перехвачен`, { position: video.currentTime, paused: video.paused, activeContext: !!c, revision: c?.revision })
    // Seeking is diagnostic only: broadcast the settled position once seeked arrives.
    if (event.type === "seeking") return
    if (!c || !video || event.target !== video) return
    if (event.type === "canplay" || event.type === "loadedmetadata") { this.update(c.roomId, c.revision, c.playback); return }
    if (event.type === "play" || event.type === "pause") {
      if (video.paused === this.expectedPaused) return
    } else if (event.type === "seeked") {
      if (now() <= this.remoteSeekUntil && Math.abs(video.currentTime - this.expectedPosition) < 0.3) {
        console.info("[WTG seek] Подавлено как эхо общей команды", { position: video.currentTime, expectedPosition: this.expectedPosition })
        if (c.playback.preparation && !video.seeking && video.readyState >= 2) this.report("ready")
        return
      }
    } else if (event.type === "ratechange" && Math.abs(video.playbackRate - this.expectedRate) < 0.001) return
    const request: PlaybackRequest = { epoch: c.playback.epoch, commandId: crypto.randomUUID(), revision: c.revision, action: event.type === "play" ? "play" : event.type === "pause" ? "pause" : event.type === "seeked" ? "seek" : "rate", position: video.currentTime, rate: video.playbackRate }
    if (event.type === "play") { this.expectedPaused = true; video.pause() }
    const dispatch = () => {
      const current = this.context
      // Polling and readiness updates replace the context object, not the user's intent.
      if (current?.roomId === c.roomId && current.revision === c.revision &&
        current.playback.epoch === c.playback.epoch && this.video === video && video.isConnected) {
        if (request.action === "seek") console.info("[WTG seek] Передаём запрос в background", { position: request.position, revision: request.revision, commandId: request.commandId })
        this.send(c.roomId, c.revision, { kind: "request", request })
      } else if (request.action === "seek") console.info("[WTG seek] Запрос устарел: контекст просмотра изменился", { position: request.position })
    }
    if (event.type === "seeked") {
      console.info("[WTG seek] Запрос перемотки поставлен в очередь (150 мс)", { position: request.position, commandId: request.commandId })
      clearTimeout(this.seekTimer); this.seekTimer = setTimeout(dispatch, 150)
    }
    else dispatch()
  }
  private showUnlock() {
    if (this.overlay) return
    const panel = document.createElement("div")
    panel.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:16px;background:#fff;color:#111;border:2px solid #7c3aed;border-radius:8px;font:14px system-ui"
    const button = document.createElement("button")
    button.textContent = "Разрешить воспроизведение"
    button.onclick = () => {
      const c = this.context, command = c?.playback.command
      if (!c?.playback.clock || !command || command.paused || c.playback.preparation || !this.video) return
      if (!this.seek(positionAt(command, now() + c.playback.clock.offset), command.rate)) return
      this.expectedPaused = false
      // Call play directly inside the user gesture, not after a runtime round-trip.
      void this.video.play().then(() => { panel.remove(); this.overlay = undefined; this.report("ready") }, () => this.report("blocked", "Браузер всё ещё запрещает запуск"))
    }
    panel.append(button); document.documentElement.append(panel); this.overlay = panel
  }
}
