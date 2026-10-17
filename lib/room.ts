import { joinRoom, selfId } from "trystero"
import { decodeInvitation, encodeInvitation, validShared, type Invitation, type RoomCommand, type RoomView, type SharedState } from "./room-protocol"

const empty = (): SharedState => ({ url: null, video: null, playback: { position: 0, paused: true, rate: 1 } })
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("")
let room: ReturnType<typeof joinRoom> | undefined
let invite: Invitation | undefined
let generation = 0
let sequence = 0
let lastAdminSeen = 0
let timer: ReturnType<typeof setInterval> | undefined
let view: RoomView = { ready: false, status: "idle", selfId, adminId: null, invitation: null, participants: [], shared: empty(), error: null }

async function disconnect() {
  generation++
  clearInterval(timer)
  timer = undefined
  const previous = room
  room = undefined
  await previous?.leave()
}

async function connect() {
  if (!invite) throw new Error("Нет приглашения для повторного входа")
  await disconnect()
  const epoch = generation
  const current = invite
  const isAdmin = current.adminId === selfId
  sequence = 0
  lastAdminSeen = Date.now()
  view = { ...view, ready: isAdmin, status: "waiting", adminId: current.adminId, invitation: encodeInvitation(current), participants: [selfId], error: null }
  try {
    room = joinRoom({ appId: "wtg-watch-together-v1", password: current.secret }, current.roomId, {
      onJoinError: () => {
        if (epoch === generation) view = { ...view, status: "error", error: "Не удалось установить WebRTC. Проверьте сеть, приглашение и доступность реле; в некоторых сетях нужен TURN." }
      }
    })
    const transport = room
    const action = transport.makeAction("wtg-state")
    const rates = new Map<string, { start: number; count: number }>()
    const seen = new Map<string, string[]>()
    const send = (kind: "hello" | "snapshot", target?: string) => {
      const message = { version: 1, roomId: current.roomId, id: crypto.randomUUID(), kind, sequence: ++sequence,
        ...(kind === "snapshot" ? { shared: view.shared, participants: view.participants } : {}) }
      void action.send(message, target ? { target } : undefined).catch(() => {
        if (epoch === generation) view = { ...view, error: "Сообщение не доставлено. Ожидаем восстановления связи." }
      })
    }
    action.onMessage = (value, { peerId }) => {
      if (epoch !== generation || !value || typeof value !== "object") return
      const raw = JSON.stringify(value)
      if (raw.length > 32768) return
      const now = Date.now()
      const rate = rates.get(peerId)
      if (!rate || now - rate.start > 1000) rates.set(peerId, { start: now, count: 1 })
      else if (++rate.count > 20) return
      const m = value as Record<string, unknown>
      if (m.version !== 1) { view = { ...view, error: "У участника несовместимая версия протокола" }; return }
      if (m.roomId !== current.roomId || typeof m.id !== "string" || m.id.length > 64 || !Number.isSafeInteger(m.sequence)) return
      const ids = seen.get(peerId) || []
      if (ids.includes(m.id)) return
      seen.set(peerId, [...ids.slice(-127), m.id])
      if (m.kind === "hello" && isAdmin) send("snapshot", peerId)
      if (m.kind === "snapshot" && peerId === current.adminId && validShared(m.shared) && Array.isArray(m.participants) && m.participants.length <= 100 && m.participants.every(p => typeof p === "string" && p.length <= 128)) {
        lastAdminSeen = now
        view = { ...view, ready: true, status: "connected", error: null, shared: m.shared, participants: [...new Set([selfId, current.adminId, ...m.participants])] }
      }
    }
    transport.onPeerJoin = peerId => {
      if (epoch !== generation) return
      view = { ...view, participants: [...new Set([...view.participants, peerId])] }
      if (isAdmin) { view.status = "connected"; send("snapshot") }
      else send("hello", current.adminId)
    }
    transport.onPeerLeave = peerId => {
      if (epoch !== generation) return
      rates.delete(peerId)
      seen.delete(peerId)
      view = { ...view, participants: view.participants.filter(id => id !== peerId) }
      if (peerId === current.adminId) view.status = "reconnecting"
      if (isAdmin) { view.status = view.participants.length > 1 ? "connected" : "waiting"; send("snapshot") }
    }
    timer = setInterval(() => {
      if (epoch !== generation) return
      if (isAdmin) send("snapshot")
      else {
        send("hello", current.adminId)
        if (Date.now() - lastAdminSeen > 15000) view = { ...view, status: "reconnecting", error: "Администратор недоступен. Ожидаем соединения; можно повторить вход." }
      }
    }, 5000)
  } catch (error) {
    await disconnect()
    view = { ...view, status: "error", error: error instanceof Error ? error.message : "Не удалось войти в комнату" }
  }
}

// Serialize mutations so double clicks/retry cannot leave overlapping rooms.
let pending: Promise<unknown> = Promise.resolve()
export function roomCommand(command: RoomCommand): Promise<RoomView> {
  const task = pending.then(async () => {
    if (command.kind === "leave") {
      await disconnect()
      invite = undefined
      view = { ready: false, status: "idle", selfId, adminId: null, invitation: null, participants: [], shared: empty(), error: null }
    }
    if (command.kind === "create" || command.kind === "join") {
      if (invite) throw new Error("Сначала выйдите из текущей комнаты")
      invite = command.kind === "create" ? { version: 1, roomId: randomToken(), secret: randomToken(), adminId: selfId } : decodeInvitation(command.invitation.trim())
      view.shared = command.kind === "create" ? command.initial || empty() : empty()
      await connect()
    }
    if (command.kind === "retry") await connect()
    return structuredClone(view)
  })
  pending = task.catch(() => {})
  return task
}
