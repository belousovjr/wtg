export const now = () => performance.timeOrigin + performance.now()
export type PlaybackRequest = { epoch: string; commandId: string; revision: number; action: "play" | "pause" | "seek" | "rate"; position: number; rate: number }
export type Commit = { epoch: string; revision: number; sequence: number; commandId: string; executeAt: number; position: number; paused: boolean; rate: number }
export type Preparation = { epoch: string; revision: number; id: string; commandId?: string; position: number; rate: number; deadline: number }
export type PlayerReport = { epoch: string; revision: number; preparationId?: string; sequence?: number; status: "ready" | "loading" | "blocked" | "missing" | "error"; detail?: string; lateness?: number }
export type ClockEstimate = { offset: number; rtt: number; uncertainty: number }
export type PlaybackWire = { epoch: string; sequence: number; preparation: Preparation | null; command: Commit | null; players: Record<string, PlayerReport> }
export type PlaybackLocal = PlaybackWire & { clock: ClockEstimate | null; participantIds?: string[]; selfId?: string; adminSync?: { synchronized: number; total: number } }
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v)
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
export function validPlaybackRequest(v: unknown): v is PlaybackRequest {
  if (!v || typeof v !== "object") return false
  const r = v as PlaybackRequest
  return typeof r.epoch === "string" && r.epoch.length > 0 && r.epoch.length <= 64 && typeof r.commandId === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(r.commandId) && revision(r.revision) && ["play", "pause", "seek", "rate"].includes(r.action) && finite(r.position) && r.position >= 0 && finite(r.rate) && r.rate >= 0.25 && r.rate <= 4
}
export function validCommit(v: unknown): v is Commit {
  if (!v || typeof v !== "object") return false
  const c = v as Commit
  return typeof c.epoch === "string" && c.epoch.length <= 64 && revision(c.revision) && revision(c.sequence) && typeof c.commandId === "string" && c.commandId.length <= 64 && finite(c.executeAt) && finite(c.position) && c.position >= 0 && typeof c.paused === "boolean" && finite(c.rate) && c.rate >= 0.25 && c.rate <= 4
}
export function validPreparation(v: unknown): v is Preparation {
  if (!v || typeof v !== "object") return false
  const p = v as Preparation
  return typeof p.epoch === "string" && p.epoch.length <= 64 && revision(p.revision) && typeof p.id === "string" && p.id.length <= 64 && (p.commandId === undefined || typeof p.commandId === "string" && p.commandId.length <= 64) && finite(p.position) && p.position >= 0 && finite(p.rate) && p.rate >= 0.25 && p.rate <= 4 && finite(p.deadline)
}
export function validPlayerReport(v: unknown): v is PlayerReport {
  if (!v || typeof v !== "object") return false
  const r = v as PlayerReport
  return typeof r.epoch === "string" && r.epoch.length <= 64 && revision(r.revision) && ["ready", "loading", "blocked", "missing", "error"].includes(r.status) &&
    (r.preparationId === undefined || typeof r.preparationId === "string" && r.preparationId.length <= 64) && (r.sequence === undefined || revision(r.sequence)) &&
    (r.detail === undefined || typeof r.detail === "string" && r.detail.length <= 200) && (r.lateness === undefined || finite(r.lateness))
}
export function positionAt(command: Commit, coordinatorTime: number) {
  return command.position + (command.paused ? 0 : Math.max(0, coordinatorTime - command.executeAt) / 1000 * command.rate)
}
export function driftCorrection(error: number, rate: number, uncertainty = 0) {
  const deadband = Math.max(0.08, Math.min(0.3, uncertainty / 1000))
  if (Math.abs(error) >= 0.8) return { seek: true, rate }
  if (Math.abs(error) <= deadband) return { seek: false, rate }
  return { seek: false, rate: Math.max(0.25, Math.min(4, rate * (1 + Math.max(-0.05, Math.min(0.05, error / 4))))) }
}
export function clockSample(t0: number, t1: number, t2: number, t3: number): ClockEstimate | null {
  const rtt = (t3 - t0) - (t2 - t1)
  if (![t0, t1, t2, t3].every(Number.isFinite) || t3 < t0 || t2 < t1 || rtt < 0 || rtt > 10000) return null
  return { offset: ((t1 - t0) + (t2 - t3)) / 2, rtt, uncertainty: rtt / 2 }
}
export function startLead(clocks: ClockEstimate[]) {
  return Math.min(3000, Math.max(400, 250 + Math.max(0, ...clocks.map(c => c.rtt + c.uncertainty * 2)) * 2))
}
type Options = {
  selfId: string; isAdmin: boolean; adminId: () => string | null; participants: () => string[]; ready: () => boolean; revision: () => number
  send: (kind: string, data?: object, target?: string) => Promise<unknown>
  serialize: (work: () => Promise<void>) => Promise<unknown>
  changed: (local: PlaybackLocal) => void
  committed: (command: Commit) => Promise<void>
  error: (message: string) => void
}
export class PlaybackSession {
  private epoch = crypto.randomUUID() as string
  private command: Commit | null = null
  private preparation: Preparation | null = null
  private players: Record<string, PlayerReport> = {}
  private sequence = 0
  private sourceRevision: number
  private clock: ClockEstimate | null
  private samples: { sample: ClockEstimate; at: number }[] = []
  private pings = new Map<string, number>()
  private clocks = new Map<string, ClockEstimate>()
  private seen = new Set<string>()
  private preparationCommand: PlaybackRequest | null = null
  private lastPing = 0
  private lastBroadcast = 0
  private lastAdmin: string | null = null
  private disposed = false
  private timer: ReturnType<typeof setInterval>
  constructor(private options: Options) {
    this.sourceRevision = options.revision()
    this.clock = options.isAdmin ? { offset: 0, rtt: 0, uncertainty: 0 } : null
    this.timer = setInterval(() => { void options.serialize(() => this.tick()).catch(() => {}) }, 200)
  }
  dispose() { this.disposed = true; clearInterval(this.timer) }
  wire(): PlaybackWire { return structuredClone({ epoch: this.epoch, sequence: this.sequence, preparation: this.preparation, command: this.command, players: this.players }) }
  local(): PlaybackLocal { return { ...this.wire(), clock: this.clock, participantIds: [...this.options.participants()], selfId: this.options.selfId } }
  private emit() { if (!this.disposed) this.options.changed(this.local()) }
  resetSource() {
    this.sourceRevision = this.options.revision()
    this.command = null; this.preparation = null; this.preparationCommand = null; this.players = {}
    this.emit()
  }
  private async broadcast() { await this.options.send("pb-state", { playback: this.wire() }); this.emit() }
  async acceptSnapshot(value: unknown) {
    if (this.options.isAdmin || !value || typeof value !== "object") return
    const w = value as PlaybackWire
    if (typeof w.epoch !== "string" || w.epoch.length > 64 || !revision(w.sequence) || (w.command !== null && !validCommit(w.command)) || (w.preparation !== null && !validPreparation(w.preparation))) return
    if (w.command && (w.command.epoch !== w.epoch || w.command.revision !== this.options.revision())) return
    if (w.command && w.command.sequence !== w.sequence) return
    if (w.preparation && (w.preparation.epoch !== w.epoch || w.preparation.revision !== this.options.revision())) return
    if (w.epoch === this.epoch && w.sequence < this.sequence) return
    if (w.epoch === this.epoch && w.command && this.command && w.command.sequence < this.command.sequence) return
    const fresh = w.epoch !== this.epoch || w.command?.sequence !== this.command?.sequence
    if (w.epoch !== this.epoch) { this.clock = null; this.samples = []; this.pings.clear(); this.lastPing = 0 }
    this.epoch = w.epoch; this.preparation = w.preparation; this.command = w.command
    this.sequence = w.sequence
    this.players = Object.fromEntries(Object.entries(w.players || {}).filter(([id, report]) => this.options.participants().includes(id) && validPlayerReport(report) && report.epoch === this.epoch && report.revision === this.options.revision()))
    if (fresh && w.command) await this.options.committed(w.command)
    this.emit()
  }
  async request(request: PlaybackRequest, from = this.options.selfId) {
    if (!validPlaybackRequest(request) || request.revision !== this.options.revision()) throw new Error("Команда относится к другому видео")
    if (request.epoch !== this.epoch) throw new Error("Сессия координатора изменилась. Повтори действие.")
    if (!this.options.ready()) throw new Error("Дождись подключения к администратору")
    if (!this.options.isAdmin) {
      if (!this.options.adminId()) throw new Error("Администратор недоступен")
      await this.options.send("pb-request", { request }, this.options.adminId()!)
      return
    }
    const id = `${from}:${request.commandId}`
    if (this.seen.has(id)) return
    this.seen.add(id)
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!)
    const playing = !!this.preparation || (this.command ? !this.command.paused : false)
    if (request.action === "pause" || request.action !== "play" && !playing) {
      this.preparation = null; this.preparationCommand = null
      await this.commit(request, true, Math.min(250, startLead([...this.clocks.values()])))
    } else {
      this.preparationCommand = request
      this.preparation = { epoch: this.epoch, revision: request.revision, id: crypto.randomUUID(), commandId: request.commandId, position: request.position, rate: request.rate, deadline: now() + 5000 }
      this.players = {}
      await this.broadcast()
    }
  }
  private async commit(request: PlaybackRequest, paused: boolean, lead: number) {
    this.command = { epoch: this.epoch, revision: request.revision, sequence: ++this.sequence, commandId: request.commandId, position: request.position, paused, rate: request.rate, executeAt: now() + lead }
    this.preparation = null; this.preparationCommand = null
    await this.options.committed(this.command)
    await this.options.send("pb-commit", { command: this.command })
    this.emit()
  }
  async player(report: PlayerReport, from = this.options.selfId) {
    if (!validPlayerReport(report) || report.epoch !== this.epoch || report.revision !== this.options.revision()) return
    if (report.preparationId !== undefined && report.preparationId !== this.preparation?.id) return
    if (report.sequence !== undefined && report.sequence !== this.command?.sequence) return
    this.players[from] = report
    if (this.options.isAdmin) await this.broadcast()
    else if (this.options.adminId()) await this.options.send("pb-player", { report }, this.options.adminId()!)
    this.emit()
  }
  async receive(kind: string, message: Record<string, unknown>, from: string, isAdminSender: boolean) {
    if (kind === "pb-request" && this.options.isAdmin && validPlaybackRequest(message.request)) {
      try { await this.request(message.request, from) } catch (error) { await this.options.send("pb-error", { error: error instanceof Error ? error.message : "Команда отклонена" }, from) }
    }
    if (kind === "pb-error" && isAdminSender && typeof message.error === "string") this.options.error(message.error.slice(0, 200))
    if (kind === "pb-state" && isAdminSender) await this.acceptSnapshot(message.playback)
    if (kind === "pb-commit" && isAdminSender && validCommit(message.command)) {
      const c = message.command
      if (c.revision !== this.options.revision() || c.epoch !== this.epoch || c.sequence <= this.sequence) return
      if (c.sequence !== this.sequence + 1) { await this.options.send("pb-resync", {}, from); return }
      this.sequence = c.sequence; this.command = c; this.preparation = null
      await this.options.committed(c); this.emit()
    }
    if (kind === "pb-resync" && this.options.isAdmin) await this.options.send("pb-state", { playback: this.wire() }, from)
    if (kind === "pb-player" && this.options.isAdmin && validPlayerReport(message.report)) await this.player(message.report, from)
    if (kind === "pb-ping" && this.options.isAdmin && typeof message.pingId === "string" && message.pingId.length <= 64 && finite(message.t0)) {
      const t1 = now()
      await this.options.send("pb-pong", { pingId: message.pingId, t0: message.t0, t1, t2: now() }, from)
    }
    if (kind === "pb-pong" && isAdminSender && typeof message.pingId === "string") {
      const t0 = this.pings.get(message.pingId)
      this.pings.delete(message.pingId)
      if (t0 === undefined || t0 !== message.t0) return
      const sample = clockSample(t0, Number(message.t1), Number(message.t2), now())
      if (!sample) return
      this.samples = [...this.samples.filter(s => now() - s.at < 30000), { sample, at: now() }].slice(-9)
      if (this.samples.length >= 3) {
        this.clock = this.samples.reduce((best, s) => s.sample.rtt < best.rtt ? s.sample : best, this.samples[0].sample)
        await this.options.send("pb-clock", { clock: this.clock }, from)
        this.emit()
      }
    }
    if (kind === "pb-clock" && this.options.isAdmin && message.clock && typeof message.clock === "object") {
      const c = message.clock as ClockEstimate
      if ([c.rtt, c.uncertainty, c.offset].every(Number.isFinite) && c.rtt >= 0 && c.rtt <= 10000 && c.uncertainty >= 0 && c.uncertainty <= 5000) this.clocks.set(from, c)
    }
  }
  private async tick() {
    if (this.disposed) return
    if (this.sourceRevision !== this.options.revision()) this.resetSource()
    if (!this.options.ready()) return
    if (!this.options.isAdmin) {
      const admin = this.options.adminId()
      if (admin !== this.lastAdmin) { this.clock = null; this.samples = []; this.pings.clear(); this.lastPing = 0; this.lastAdmin = admin; this.emit() }
      if (admin && now() - this.lastPing >= (this.samples.length < 3 ? 200 : 10000)) {
        const pingId = crypto.randomUUID(), t0 = now()
        this.lastPing = t0
        this.pings.set(pingId, t0)
        for (const [id, sent] of this.pings) if (t0 - sent > 10000) this.pings.delete(id)
        await this.options.send("pb-ping", { pingId, t0 }, admin)
      }
    } else if (this.preparation && this.preparationCommand) {
      const everyone = this.options.participants().every(id => this.players[id]?.preparationId === this.preparation!.id && this.players[id]?.status === "ready" && (id === this.options.selfId || this.clocks.has(id)))
      if (everyone || now() >= this.preparation.deadline) await this.commit(this.preparationCommand, false, startLead([...this.clocks.values()]))
    }
    if (this.options.isAdmin && now() - this.lastBroadcast >= 2000) {
      this.lastBroadcast = now()
      await this.broadcast()
    }
  }
}
