import { joinRoom, selfId } from "trystero"
import { challengeText, createIdentity, sign, validateIdentity, verify } from "./identity"
import { endText, validCertificate, validateVault, vaultRequest, type EndCertificate, type Vault } from "./persistence"
import { decodeInvitation, encodeInvitation, validShared, type Invitation, type RoomCommand, type RoomView, type SharedState } from "./room-protocol"

const empty = (): SharedState => ({ url: null, video: null, playback: { position: 0, paused: true, rate: 1 } })
const idle = (): RoomView => ({ ready: false, isAdmin: false, status: "idle", selfId, adminId: null, invitation: null, participants: [], shared: empty(), error: null })
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("")
let vault: Vault
let invite: Invitation | undefined
let room: ReturnType<typeof joinRoom> | undefined
let generation = 0
let view = idle()
let timer: ReturnType<typeof setInterval> | undefined
let sendMessage: ((kind: string, data?: object, target?: string) => Promise<unknown>) | undefined
let initialized: Promise<void> | undefined
const tombstones = new Map<string, ReturnType<typeof joinRoom>>()
let pending: Promise<unknown> = Promise.resolve()
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const task = pending.then(work)
  pending = task.catch(() => {})
  return task
}
async function save() {
  vault.session = invite ? { invitation: encodeInvitation(invite), shared: structuredClone(view.shared) } : null
  await vaultRequest("write", vault)
}
async function disconnect() {
  generation++
  clearInterval(timer)
  timer = undefined
  sendMessage = undefined
  const previous = room
  room = undefined
  await previous?.leave()
}
async function applyEnd(certificate: EndCertificate) {
  if (!validCertificate(certificate) || !invite || certificate.roomId !== invite.roomId || certificate.adminKey !== invite.adminKey ||
    !await verify(certificate.adminKey, certificate.signature, endText(certificate))) return false
  const archived = { ...certificate, invitation: encodeInvitation(invite) }
  if (!vault.ended.some(c => c.roomId === certificate.roomId && c.adminKey === certificate.adminKey)) vault.ended.push(archived)
  await disconnect()
  invite = undefined
  view = { ...idle(), error: "Комната завершена создателем" }
  await save()
  startTombstone(archived)
  return true
}

function startTombstone(certificate: EndCertificate) {
  if (!certificate.invitation || tombstones.has(certificate.roomId)) return
  const previous = decodeInvitation(certificate.invitation)
  if (previous.roomId !== certificate.roomId || previous.adminKey !== certificate.adminKey) return
  const relay = joinRoom({ appId: "wtg-watch-together-v2", password: previous.secret }, previous.roomId)
  tombstones.set(previous.roomId, relay)
  const action = relay.makeAction("wtg-state")
  const announce = (peerId: string) => action.send({ version: 2, roomId: previous.roomId, id: crypto.randomUUID(), sequence: 1, kind: "ended", certificate }, { target: peerId }).catch(() => {})
  relay.onPeerJoin = peerId => { void announce(peerId) }
}

async function connect(retryDelay = 30000) {
  if (!invite || !vault.identity) throw new Error("Нет сохранённой комнаты")
  await disconnect()
  const epoch = generation, current = invite, identity = vault.identity
  const isAdmin = identity.publicKey === current.adminKey
  view = { ...view, ready: isAdmin, isAdmin, adminId: isAdmin ? selfId : null, status: "waiting", participants: isAdmin ? [selfId] : [], invitation: encodeInvitation(current), error: null }
  let sequence = 0, lastAdminSeen = Date.now(), nextRetry = Date.now() + retryDelay
  const challenges = new Map<string, { nonce: string; expires: number }>()
  const authenticated = new Map<string, string>()
  const rates = new Map<string, { start: number; count: number }>()
  const seen = new Map<string, string[]>()
  try {
    room = joinRoom({ appId: "wtg-watch-together-v2", password: current.secret }, current.roomId, {
      onJoinError: () => { if (epoch === generation) view = { ...view, status: "error", error: "Соединение не установлено. Повторяем автоматически; в некоторых сетях нужен TURN." } }
    })
    const transport = room, action = transport.makeAction("wtg-state")
    const send = async (kind: string, data: object = {}, target?: string) => {
      if (epoch !== generation) return
      await action.send({ version: 2, roomId: current.roomId, id: crypto.randomUUID(), sequence: ++sequence, kind, ...data }, target ? { target } : undefined)
    }
    sendMessage = send
    const snapshot = async (target?: string) => {
      if (!isAdmin) return
      view.participants = [selfId, ...authenticated.keys()]
      view.status = view.participants.length > 1 ? "connected" : "waiting"
      await send("snapshot", { shared: view.shared, participants: view.participants }, target)
    }
    const challenge = async (peerId: string) => {
      if (authenticated.has(peerId)) return
      if (challenges.get(peerId)?.expires! > Date.now()) return
      const nonce = randomToken()
      challenges.set(peerId, { nonce, expires: Date.now() + 10000 })
      await send("challenge", { nonce }, peerId)
    }
    const receive = async (value: unknown, peerId: string) => {
      if (epoch !== generation || !value || typeof value !== "object") return
      const raw = JSON.stringify(value)
      if (raw.length > 32768) return
      const now = Date.now(), rate = rates.get(peerId)
      if (!rate || now - rate.start > 1000) rates.set(peerId, { start: now, count: 1 })
      else if (++rate.count > 20) return
      const m = value as Record<string, unknown>
      if (m.version !== 2) { view.error = "У участника несовместимая версия протокола"; return }
      if (m.roomId !== current.roomId || typeof m.id !== "string" || m.id.length > 64 || !Number.isSafeInteger(m.sequence)) return
      const ids = seen.get(peerId) || []
      if (ids.includes(m.id)) return
      seen.set(peerId, [...ids.slice(-127), m.id])
      if (m.kind === "challenge" && typeof m.nonce === "string" && /^[a-f0-9]{48}$/.test(m.nonce)) {
        await send("proof", { nonce: m.nonce, publicKey: identity.publicKey, signature: await sign(identity, challengeText(current.roomId, peerId, selfId, m.nonce)) }, peerId)
        await challenge(peerId)
      }
      if (m.kind === "proof") {
        const expected = challenges.get(peerId)
        if (!expected || expected.expires < now || m.nonce !== expected.nonce || typeof m.publicKey !== "string" || typeof m.signature !== "string") return
        challenges.delete(peerId)
        if (!await verify(m.publicKey, m.signature, challengeText(current.roomId, selfId, peerId, expected.nonce)) || epoch !== generation) return
        authenticated.set(peerId, m.publicKey)
        if (m.publicKey === current.adminKey) { view.adminId = peerId; lastAdminSeen = now }
        if (isAdmin) await snapshot()
        else await send("hello", {}, peerId)
      }
      if (m.kind === "hello" && authenticated.has(peerId)) {
        if (isAdmin) await snapshot(peerId)
        const ended = vault.ended.find(c => c.roomId === current.roomId && c.adminKey === current.adminKey)
        if (ended) await send("ended", { certificate: ended }, peerId)
      }
      if (m.kind === "snapshot" && authenticated.get(peerId) === current.adminKey && validShared(m.shared) && Array.isArray(m.participants) && m.participants.length <= 100 && m.participants.every(p => typeof p === "string" && p.length <= 128)) {
        lastAdminSeen = now
        retryDelay = 30000
        nextRetry = now + retryDelay
        view = { ...view, ready: true, status: "connected", adminId: peerId, error: null, shared: m.shared, participants: [...new Set([selfId, peerId, ...m.participants])] }
        await save()
      }
      if (m.kind === "ended" && validCertificate(m.certificate)) {
        // A signed certificate can safely be forwarded by any peer.
        await applyEnd(m.certificate)
      }
    }
    action.onMessage = (value, { peerId }) => { void serialized(() => receive(value, peerId)).catch(error => { view.error = error instanceof Error ? error.message : "Ошибка обработки сообщения" }) }
    transport.onPeerJoin = peerId => { void serialized(async () => {
      if (epoch === generation) await challenge(peerId)
    }).catch(() => { view.error = "Не удалось подтвердить участника" }) }
    transport.onPeerLeave = peerId => {
      void serialized(async () => {
        if (epoch !== generation) return
        authenticated.delete(peerId); challenges.delete(peerId); rates.delete(peerId); seen.delete(peerId)
        if (view.adminId === peerId) { view.adminId = null; view.ready = false; view.status = "reconnecting" }
        if (isAdmin) await snapshot()
      }).catch(() => {})
    }
    timer = setInterval(() => { void serialized(async () => {
      if (epoch !== generation) return
      if (isAdmin) await snapshot()
      else {
        if (view.adminId) await send("hello", {}, view.adminId)
        if (Date.now() - lastAdminSeen > 15000) { view.ready = false; view.status = "reconnecting"; view.error = "Ожидаем возвращения администратора" }
        if (!view.ready && Date.now() >= nextRetry) {
          // Trystero retries signaling too; periodic rebuild recovers stale transports.
          await connect(Math.min(retryDelay * 2, 300000))
        }
      }
    }).catch(error => { view.error = error instanceof Error ? error.message : "Ошибка соединения" }) }, 5000)
  } catch (error) {
    await disconnect()
    view = { ...view, status: "error", error: error instanceof Error ? error.message : "Ошибка подключения" }
  }
}

export function initializeRoom() {
  if (!initialized) initialized = (async () => {
    vault = validateVault(await vaultRequest("read"))
    if (!vault.identity) { vault.identity = await createIdentity(); await vaultRequest("write", vault) }
    if (!await validateIdentity(vault.identity)) throw new Error("Сохранённые ключи не соответствуют друг другу; восстановление остановлено")
    for (const certificate of vault.ended) {
      if (await verify(certificate.adminKey, certificate.signature, endText(certificate))) startTombstone(certificate)
    }
    if (vault.session) {
      invite = decodeInvitation(vault.session.invitation)
      view.shared = { ...vault.session.shared, playback: { ...vault.session.shared.playback, paused: true } }
      const ended = vault.ended.find(c => c.roomId === invite!.roomId && c.adminKey === invite!.adminKey)
      if (ended && await applyEnd(ended)) return
      await save()
      await connect()
    }
  })()
  return initialized
}

export function roomCommand(command: RoomCommand): Promise<RoomView> {
  return serialized(async () => {
    await initializeRoom()
    if (command.kind === "status" && invite && !room) await connect(60000)
    if (command.kind === "leave") {
      await disconnect(); invite = undefined; view = idle(); await save()
    }
    if (command.kind === "create" || command.kind === "join") {
      if (invite) throw new Error("Сначала выйдите из текущей комнаты")
      const next: Invitation = command.kind === "create" ? { version: 2, roomId: randomToken(), secret: randomToken(), adminKey: vault.identity!.publicKey } : decodeInvitation(command.invitation.trim())
      if (vault.ended.some(c => c.roomId === next.roomId && c.adminKey === next.adminKey)) throw new Error("Комната уже завершена")
      invite = next
      view.shared = command.kind === "create" ? command.initial || empty() : empty()
      await save()
      await connect()
    }
    if (command.kind === "retry") await connect()
    if (command.kind === "end") {
      if (!invite || !view.isAdmin) throw new Error("Завершить комнату может только создатель")
      const data = { roomId: invite.roomId, adminKey: invite.adminKey, endedAt: Date.now() }
      const certificate = { ...data, signature: await sign(vault.identity!, endText(data)), invitation: encodeInvitation(invite) }
      // Persist before transmission; never reopen a room if delivery is interrupted.
      vault.ended.push(certificate)
      await vaultRequest("write", vault)
      try { await sendMessage?.("ended", { certificate }) } finally { await applyEnd(certificate) }
    }
    return structuredClone(view)
  })
}
