import { driftCorrection, now, positionAt, validCommit, validPreparation, type PlaybackLocal, type PlaybackRequest, type PlayerReport } from "./playback"
import { PlayerIndicator } from "./player-indicator"

type EventMessage = { kind: "request"; request: PlaybackRequest } | { kind: "report"; report: PlayerReport }
export class PlayerSync {
  private indicator = new PlayerIndicator()
  private playPending = false
  private renderIndicator() {
    if (this.context) this.indicator.update(this.video, this.context.playback, this.context.revision, this.userSeeking || !!this.pendingSeekId || this.pendingManual, this.autoplayBlocked, this.playPending || !!this.scheduled)
  }
  private context?: { roomId: string; revision: number; playback: PlaybackLocal }
  private video?: HTMLVideoElement
  private timer?: ReturnType<typeof setTimeout>
  private seekTimer?: ReturnType<typeof setTimeout>
  private pauseTimer?: ReturnType<typeof setTimeout>
  private applied = ""
  private scheduled = ""
  private prepared = ""
  private expectedPaused = true
  private expectedPosition = 0
  private remoteSeekPending = false
  private expectedRate = 1
  private autoplayBlocked = false
  private lastReport = ""
  private correctionTimer?: ReturnType<typeof setInterval>
  private pendingManual = false
  private userSeeking = false
  private pendingSeekId?: string
  private correctionUntil = 0
  private lastTrace = ""
  constructor(private getVideo: () => HTMLVideoElement | undefined, private send: (roomId: string, revision: number, message: EventMessage) => void) {}
  bind() {
    const video = this.getVideo()
    if (video === this.video) return
    this.playPending = false
    clearTimeout(this.seekTimer)
    clearTimeout(this.pauseTimer)
    this.pendingManual = false; this.userSeeking = false; this.pendingSeekId = undefined
    if (this.video) { this.expectedPaused = true; this.video.pause() }
    for (const name of ["play", "pause", "seeking", "seeked", "ratechange", "canplay", "loadedmetadata"]) this.video?.removeEventListener(name, this.onEvent)
    this.video = video; this.applied = ""; this.prepared = ""; this.scheduled = ""
    clearTimeout(this.timer)
    this.remoteSeekPending = false
    for (const name of ["play", "pause", "seeking", "seeked", "ratechange", "canplay", "loadedmetadata"]) video?.addEventListener(name, this.onEvent)
    console.info("[WTG seek] Обработчики плеера", { attached: !!video, connected: !!video?.isConnected, activeContext: !!this.context })
    this.lastReport = ""
    if (!video) this.report("missing", "Плеер не найден")
  }
  update(roomId: string, revision: number, playback: PlaybackLocal | null) {
    const trace = JSON.stringify([revision, playback?.epoch, playback?.command?.sequence, playback?.command?.paused, playback?.preparation?.id, this.pendingSeekId, this.userSeeking])
    if (trace !== this.lastTrace) {
      this.lastTrace = trace
      console.info("[WTG playback] Состояние", { revision, sequence: playback?.command?.sequence, paused: playback?.command?.paused,
        commandId: playback?.command?.commandId, preparationId: playback?.preparation?.id,
        preparationCommandId: playback?.preparation?.commandId, pendingSeekId: this.pendingSeekId, userSeeking: this.userSeeking })
    }
    if (!playback) {
      this.playPending = false
      this.indicator.clear()
      this.pendingSeekId = undefined; this.userSeeking = false; this.pendingManual = false
      this.remoteSeekPending = false
      clearInterval(this.correctionTimer); this.correctionTimer = undefined
      this.context = undefined; clearTimeout(this.timer); clearTimeout(this.seekTimer)
      clearTimeout(this.pauseTimer)
      this.expectedPaused = true; this.video?.pause(); this.autoplayBlocked = false
      this.applied = ""; this.scheduled = ""; this.prepared = ""; this.lastReport = ""
      return
    }
    if (!this.correctionTimer) this.correctionTimer = setInterval(() => { this.correctDrift(); this.renderIndicator() }, 250)
    if (this.context?.playback.epoch === playback.epoch && this.context.revision === revision && playback.command && this.context.playback.command && playback.command.sequence < this.context.playback.command.sequence) return
    if (playback.command && !validCommit(playback.command) || playback.preparation && !validPreparation(playback.preparation)) return
    if (this.context?.roomId !== roomId || this.context.revision !== revision || this.context.playback.epoch !== playback.epoch) {
      this.playPending = false
      clearTimeout(this.timer); clearTimeout(this.seekTimer)
      clearTimeout(this.pauseTimer)
      this.applied = ""; this.scheduled = ""; this.prepared = ""; this.lastReport = ""
      this.expectedPaused = true
      this.indicator.clear()
      this.pendingSeekId = undefined; this.userSeeking = false; this.pendingManual = false
      this.autoplayBlocked = false
    }
    if (this.context?.playback.command?.sequence !== playback.command?.sequence || this.context?.playback.preparation?.id !== playback.preparation?.id) {
      this.playPending = false
      this.pendingManual = false
    }
    this.context = { roomId, revision, playback }
    this.bind()
    this.renderIndicator()
    if (this.pendingSeekId && (playback.preparation?.commandId === this.pendingSeekId || playback.command?.commandId === this.pendingSeekId)) {
      this.pendingSeekId = undefined; this.pendingManual = false
    }
    // No snapshot, canplay callback or scheduled old command may undo an explicit seek.
    if (this.userSeeking || this.pendingSeekId) {
      console.info("[WTG playback] Применение отложено: ручная перемотка", { userSeeking: this.userSeeking, pendingSeekId: this.pendingSeekId })
      return
    }
    const video = this.video
    if (!video?.isConnected) { this.report("missing", "Плеер не найден"); return }
    const prep = playback.preparation
    if (prep && prep.revision === revision) {
      clearTimeout(this.timer); this.scheduled = ""
      this.expectedPaused = true; video.pause()
      if (this.prepared !== prep.id && !this.seek(prep.position, prep.rate)) return
      this.prepared = prep.id
      this.report(video.seeking || video.readyState < 2 ? "loading" : "ready")
      return
    }
    const command = playback.command
    if (!command) { this.expectedPaused = true; video.pause(); return }
    if (command.revision !== revision) return
    if (this.playPending || this.autoplayBlocked && !command.paused) return
    const id = `${command.epoch}:${command.sequence}`
    if (this.applied === id || this.scheduled === id) return
    if (!playback.clock) { this.report("loading", "Согласуем часы"); return }
    this.scheduled = id
    clearTimeout(this.timer)
    const execute = () => {
      this.scheduled = ""
      if (this.userSeeking || this.pendingSeekId) return
      if (this.context?.playback.command?.sequence !== command.sequence || this.context.playback.epoch !== command.epoch || this.context.playback.preparation) return
      const coordinatorTime = now() + this.context.playback.clock!.offset
      if (coordinatorTime < command.executeAt) {
        this.scheduled = id
        this.timer = setTimeout(execute, command.executeAt - coordinatorTime)
        return
      }
      const aligned = this.seek(positionAt(command, coordinatorTime), command.rate)
      if (!aligned) {
        console.info("[WTG playback] Запуск отложен: позиция недоступна", { sequence: command.sequence, position: video.currentTime, readyState: video.readyState, seeking: video.seeking })
        if (command.paused) return
      }
      this.expectedPaused = command.paused
      this.applied = aligned ? id : ""
      const late = Math.max(0, coordinatorTime - command.executeAt)
      if (command.paused) { video.pause(); this.autoplayBlocked = false; this.report("ready", undefined, late) }
      else {
        this.playPending = true
        console.info("[WTG playback] Вызываем play()", { sequence: command.sequence, position: video.currentTime, readyState: video.readyState, seeking: video.seeking })
        void video.play().then(() => {
        if (this.context?.playback.command?.sequence === command.sequence && this.context.playback.epoch === command.epoch) this.playPending = false
        console.info("[WTG playback] play() выполнен", { sequence: command.sequence, paused: video.paused, position: video.currentTime })
        if (this.context?.playback.command?.sequence === command.sequence && this.context.playback.epoch === command.epoch && !this.context.playback.preparation) {
          this.report(aligned ? "ready" : "loading", aligned ? undefined : "Ждём metadata и позицию просмотра", late)
          this.renderIndicator()
        }
      }, error => {
        if (this.context?.playback.command?.sequence === command.sequence && this.context.playback.epoch === command.epoch) this.playPending = false
        console.warn("[WTG playback] play() отклонён", { sequence: command.sequence, name: error?.name })
        if (this.context?.playback.command?.sequence !== command.sequence || this.context.playback.epoch !== command.epoch || this.context.playback.preparation) return
        this.report(error?.name === "NotAllowedError" ? "blocked" : "error", error?.name === "NotAllowedError" ? "Нажми Play на плеере" : "Браузер не смог запустить видео")
        if (error?.name === "NotAllowedError") this.showUnlock()
        this.renderIndicator()
      })
      }
    }
    this.timer = setTimeout(execute, Math.max(0, command.executeAt - playback.clock.offset - now()))
  }
  private correctDrift() {
    const c = this.context, video = this.video, command = c?.playback.command
    if (!c || !video?.isConnected || !command || !c.playback.clock || c.playback.preparation ||
      command.revision !== c.revision || this.pendingManual || this.pendingSeekId || this.userSeeking || video.seeking ||
      this.applied !== `${command.epoch}:${command.sequence}` || now() < this.correctionUntil) return
    if (this.autoplayBlocked && !command.paused) return
    if (video.readyState < 2) { this.report("loading", "Буферизация · догоним после загрузки"); return }
    if (!Number.isFinite(video.duration) || video.duration <= 0) return
    const target = Math.min(positionAt(command, now() + c.playback.clock.offset), Math.max(0, video.duration - 0.05))
    const error = target - video.currentTime
    // Never resume a locally paused/blocked player or override an ongoing manual action.
    if (!command.paused && video.paused) return
    const correction = driftCorrection(error, command.rate, c.playback.clock.uncertainty)
    if (correction.seek || command.paused && Math.abs(error) > 0.08) {
      if (!this.seek(target, command.rate)) return
      this.correctionUntil = now() + 1000
    } else {
      const rate = command.paused ? command.rate : correction.rate
      if (Math.abs(video.playbackRate - rate) > 0.001) {
        this.expectedRate = rate
        try { video.playbackRate = rate } catch { return }
      }
    }
    console.debug("[WTG sync] Коррекция таймлайна", { driftMs: Math.round(error * 1000), rate: video.playbackRate, seek: correction.seek })
    const converging = Math.abs(error) > Math.max(0.12, Math.min(0.3, c.playback.clock.uncertainty / 1000))
    this.report(converging ? "loading" : "ready", converging ? "Выравниваем позицию просмотра" : undefined)
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
      if (Math.abs(video.currentTime - target) > 0.04) { this.remoteSeekPending = true; video.currentTime = target }
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
    if (event.type === "seeking") {
      if (video && event.target === video) {
        this.userSeeking = !(this.remoteSeekPending && Math.abs(video.currentTime - this.expectedPosition) < 0.3)
        if (this.userSeeking) this.remoteSeekPending = false
      }
      if (this.userSeeking) {
        this.indicator.begin()
        this.renderIndicator()
        clearTimeout(this.pauseTimer)
        clearTimeout(this.timer); this.scheduled = ""
      }
      return
    }
    if (!c || !video || event.target !== video) return
    if (event.type === "play" && this.autoplayBlocked && !video.paused) {
      this.autoplayBlocked = false
      this.expectedPaused = false
      this.applied = ""
      this.indicator.begin(c.playback.command?.commandId)
      this.report("loading", "Подключаемся к общему просмотру")
      this.renderIndicator()
      this.update(c.roomId, c.revision, c.playback)
      return
    }
    if (event.type === "canplay" || event.type === "loadedmetadata") { this.update(c.roomId, c.revision, c.playback); return }
    if (event.type === "play" || event.type === "pause") {
      console.info("[WTG playback] Событие плеера", { type: event.type, paused: video.paused, expectedPaused: this.expectedPaused,
        position: video.currentTime, seeking: video.seeking, readyState: video.readyState, pendingSeekId: this.pendingSeekId, userSeeking: this.userSeeking })
      if (event.type === "play") clearTimeout(this.pauseTimer)
      if (this.userSeeking || this.pendingSeekId) return
      if (event.type === "pause" && (video.seeking || this.remoteSeekPending || c.playback.preparation)) return
      if (video.paused === this.expectedPaused) return
    } else if (event.type === "seeked") {
      this.userSeeking = false
      if (this.remoteSeekPending && Math.abs(video.currentTime - this.expectedPosition) < 0.3) {
        this.remoteSeekPending = false
        console.info("[WTG seek] Подавлено как эхо общей команды", { position: video.currentTime, expectedPosition: this.expectedPosition })
        if (c.playback.preparation && !video.seeking && video.readyState >= 2) this.report("ready")
        return
      }
    } else if (event.type === "ratechange" && Math.abs(video.playbackRate - this.expectedRate) < 0.001) return
    this.pendingManual = true
    const request: PlaybackRequest = { epoch: c.playback.epoch, commandId: crypto.randomUUID(), revision: c.revision, action: event.type === "play" ? "play" : event.type === "pause" ? "pause" : event.type === "seeked" ? "seek" : "rate", position: video.currentTime, rate: event.type === "ratechange" ? video.playbackRate : c.playback.command?.rate ?? video.playbackRate }
    if (event.type === "seeked") this.pendingSeekId = request.commandId
    this.indicator.begin(request.commandId)
    this.renderIndicator()
    if (event.type === "play") { this.expectedPaused = true; video.pause() }
    const dispatch = () => {
      const current = this.context
      // Polling and readiness updates replace the context object, not the user's intent.
      if (current?.roomId === c.roomId && current.revision === c.revision &&
        current.playback.epoch === c.playback.epoch && this.video === video && video.isConnected) {
        if (request.action === "pause" && (!video.paused || video.seeking || this.userSeeking || this.pendingSeekId || current.playback.preparation)) return
        console.info("[WTG playback] Запрос", { action: request.action, position: request.position, commandId: request.commandId })
        if (request.action === "seek") console.info("[WTG seek] Передаём запрос в background", { position: request.position, revision: request.revision, commandId: request.commandId })
        this.send(c.roomId, c.revision, { kind: "request", request })
      } else if (request.action === "seek") console.info("[WTG seek] Запрос устарел: контекст просмотра изменился", { position: request.position })
    }
    if (event.type === "seeked") {
      clearTimeout(this.pauseTimer)
      console.info("[WTG seek] Запрос перемотки поставлен в очередь (150 мс)", { position: request.position, commandId: request.commandId })
      clearTimeout(this.seekTimer); this.seekTimer = setTimeout(dispatch, 150)
    }
    else if (event.type === "pause") {
      // Custom players may pause immediately before initiating a seek.
      clearTimeout(this.pauseTimer)
      this.pauseTimer = setTimeout(dispatch, 250)
    } else dispatch()
  }
  private showUnlock() {
    this.autoplayBlocked = true
  }
}
