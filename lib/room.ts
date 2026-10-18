import { t } from "./i18n"
import { joinRoom, selfId } from "trystero"
import { PlaybackSession } from "./playback"
import { commitSource, sourceRevision, validReadiness, type SourceCommand, type SourceReadiness } from "./source"
import { validRoomCommand, validNickname } from "./room-protocol"
import { canAcceptMemberCommand, isAdmitted, policyText, validPolicy, type MemberCommand, type MembershipPolicy } from "./membership"
import { challengeText, createIdentity, sign, validateIdentity, verify } from "./identity"
import { endText, validCertificate, validateVault, vaultRequest, type EndCertificate, type Vault } from "./persistence"
import { decodeInvitation, encodeInvitation, validShared, type Invitation, type RoomCommand, type RoomView, type SharedState } from "./room-protocol"

const empty = (): SharedState => ({ url: null, video: null, playback: { position: 0, paused: true, rate: 1 } })
const idle = (): RoomView => ({ sourceReadiness: {}, pendingParticipants: [], blockedKeys: [], approvalRequired: false, ready: false, isAdmin: false, status: "idle", selfId, adminId: null, invitation: null, participants: [], shared: empty(), error: null })
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("")
let vault: Vault
let invite: Invitation | undefined
let room: ReturnType<typeof joinRoom> | undefined
let generation = 0
let view = idle()
let timer: ReturnType<typeof setInterval> | undefined
let sendMessage: ((kind: string, data?: object, target?: string) => Promise<unknown>) | undefined
let manageMember: ((command: MemberCommand) => Promise<void>) | undefined
let changeSource: ((command: SourceCommand) => Promise<void>) | undefined
let reportSource: ((readiness: SourceReadiness) => Promise<void>) | undefined
let playbackSession: PlaybackSession | undefined
let observer: ((view: RoomView, roomId: string | null) => void) | undefined
export function observeSource(callback: NonNullable<typeof observer>) { observer = callback }
function notifySource() { observer?.(structuredClone(view), invite?.roomId || null) }
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
  playbackSession?.dispose(); playbackSession = undefined
  generation++
  clearInterval(timer)
  timer = undefined
  sendMessage = undefined
  manageMember = undefined
  changeSource = undefined
  reportSource = undefined
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
  view = { ...idle(), error: t("room.ended") }
  await save()
  notifySource()
  startTombstone(archived)
  return true
}

function startTombstone(certificate: EndCertificate) {
  if (!certificate.invitation || tombstones.has(certificate.roomId)) return
  const previous = decodeInvitation(certificate.invitation)
  if (previous.roomId !== certificate.roomId || previous.adminKey !== certificate.adminKey) return
  const relay = joinRoom({ appId: "wtg-watch-together-v5", password: previous.secret }, previous.roomId)
  tombstones.set(previous.roomId, relay)
  const action = relay.makeAction("wtg-state")
  const announce = (peerId: string) => action.send({ version: 5, roomId: previous.roomId, id: crypto.randomUUID(), sequence: 1, kind: "ended", certificate }, { target: peerId }).catch(() => {})
  relay.onPeerJoin = peerId => { void announce(peerId) }
}

async function connect(retryDelay = 30000) {
  if (!invite || !vault.identity) throw new Error(t("room.noSavedRoom"))
  await disconnect()
  const epoch = generation, current = invite, identity = vault.identity
  const isAdmin = identity.publicKey === current.adminKey
  delete view.shared.control
  if (isAdmin) view.shared.playback = { ...view.shared.playback, paused: true }
  let policy = vault.policies?.find(p => p.roomId === current.roomId && p.adminKey === current.adminKey)
  if (isAdmin && !policy) {
    const data = { roomId: current.roomId, adminKey: current.adminKey, revision: 0, approvalRequired: false, allowed: [current.adminKey], blocked: [] }
    policy = { ...data, signature: await sign(identity, policyText(data)) }
    vault.policies = [...vault.policies || [], policy]
    await save()
  }
  view = { ...view, nickname: vault.nickname, participantNames: vault.nickname ? { [selfId]: vault.nickname } : {}, sync: undefined, sourceReadiness: {}, pendingParticipants: [], blockedKeys: isAdmin ? policy?.blocked || [] : [], approvalRequired: policy?.approvalRequired || false, ready: isAdmin, isAdmin, adminId: isAdmin ? selfId : null, status: "waiting", participants: isAdmin ? [selfId] : [], invitation: encodeInvitation(current), error: null }
  let sequence = 0, lastAdminSeen = Date.now(), nextRetry = Date.now() + retryDelay
  view.blockedNames = isAdmin ? Object.fromEntries((vault.removedNames || []).filter(n => n.roomId === current.roomId && view.blockedKeys.includes(n.publicKey)).map(n => [n.publicKey, n.nickname])) : {}
  const challenges = new Map<string, { nonce: string; expires: number }>()
  const authenticated = new Map<string, string>()
  let memberKeys: Record<string, string> = {}
  const rates = new Map<string, { start: number; count: number }>()
  const seen = new Map<string, string[]>()
  try {
    room = joinRoom({ appId: "wtg-watch-together-v5", password: current.secret }, current.roomId, {
      onJoinError: () => { if (epoch === generation) view = { ...view, status: "error", error: t("room.connectionFailed") } }
    })
    const transport = room, action = transport.makeAction("wtg-state")
    const send = async (kind: string, data: object = {}, target?: string) => {
      if (epoch !== generation) return
      await action.send({ version: 5, roomId: current.roomId, id: crypto.randomUUID(), sequence: ++sequence, kind, ...data, nickname: vault.nickname }, target ? { target } : undefined)
    }
    sendMessage = send
    playbackSession = new PlaybackSession({
      selfId, isAdmin, adminId: () => view.adminId, participants: () => view.participants, ready: () => view.ready && !!view.shared.video,
      revision: () => sourceRevision(view.shared), send, serialize: serialized,
      changed: local => { if (epoch === generation) { view.sync = local; notifySource() } },
      committed: async command => {
        if (epoch !== generation) return
        view.shared = { ...view.shared, control: command, playback: { position: command.position, paused: command.paused, rate: command.rate } }
        await save()
      },
      error: message => { view.error = message }
    })
    view.sync = playbackSession.local()
    const updateMembers = () => {
      if (!isAdmin) return
      view.participants = [selfId, ...[...authenticated].filter(([, key]) => isAdmitted(policy, key)).map(([id]) => id)]
      view.pendingParticipants = [...authenticated].filter(([, key]) => !isAdmitted(policy, key) && !policy?.blocked.includes(key)).map(([peerId, publicKey]) => ({ peerId, publicKey }))
      view.blockedKeys = [...policy?.blocked || []]
      view.blockedNames = Object.fromEntries((vault.removedNames || []).filter(n => n.roomId === current.roomId && view.blockedKeys.includes(n.publicKey)).map(n => [n.publicKey, n.nickname]))
      view.approvalRequired = policy?.approvalRequired || false
    }
    const publishPolicy = async (next: MembershipPolicy) => {
      policy = next
      vault.policies = [...(vault.policies || []).filter(p => p.roomId !== current.roomId || p.adminKey !== current.adminKey), next]
      await save()
      updateMembers()
      view.participantNames = Object.fromEntries([selfId, ...authenticated.keys()].filter(id => validNickname(view.participantNames?.[id])).map(id => [id, view.participantNames![id]]))
      if (!isAdmin) view.participants = view.participants.filter(id => isAdmitted(next, memberKeys[id]))
      view.approvalRequired = next.approvalRequired
      if (next.blocked.includes(identity.publicKey)) {
        await disconnect(); invite = undefined; view = { ...idle(), error: t("room.removed") }; await save(); notifySource(); return false
      }
      return true
    }
    const snapshot = async (target?: string) => {
      if (!isAdmin || !policy) return
      updateMembers()
      view.participantNames = Object.fromEntries([selfId, ...authenticated.keys()].filter(id => validNickname(view.participantNames?.[id])).map(id => [id, view.participantNames![id]]))
      view.status = view.participants.length > 1 ? "connected" : "waiting"
      view.sourceReadiness = Object.fromEntries(Object.entries(view.sourceReadiness).filter(([id]) => view.participants.includes(id)))
      notifySource()
      // Admission policy is a separate bounded packet, signed for mesh propagation.
      await send("policy", { policy }, target)
      const recipients = target ? [target] : [...authenticated.keys()]
      for (const id of recipients) {
        if (isAdmitted(policy, authenticated.get(id) || "")) {
          await send("snapshot", { participantNames: Object.fromEntries(view.participants.filter(id => validNickname(view.participantNames?.[id])).map(id => [id, view.participantNames![id]])), shared: view.shared, playbackState: playbackSession?.wire(), sourceReadiness: view.sourceReadiness, participants: view.participants, memberKeys: Object.fromEntries([[selfId, identity.publicKey], ...[...authenticated].filter(([id]) => view.participants.includes(id))]), policyRevision: policy.revision }, id)
        }
      }
    }
    const acceptedCommands = new Set<string>()
    const acceptSource = async (command: SourceCommand, peerId: string) => {
      const key = `${authenticated.get(peerId) || identity.publicKey}:${command.commandId}`
      if (acceptedCommands.has(key)) { await snapshot(peerId === selfId ? undefined : peerId); return }
      view.shared = commitSource(view.shared, command)
      playbackSession?.resetSource()
      view.sourceReadiness = {}
      view.error = null
      acceptedCommands.add(key)
      if (acceptedCommands.size > 128) acceptedCommands.delete(acceptedCommands.values().next().value!)
      await save()
      notifySource()
      await snapshot()
    }
    changeSource = async command => {
      if (!view.ready) throw new Error(t("room.waitAdmin"))
      if (isAdmin) await acceptSource(command, selfId)
      else {
        if (!view.adminId) throw new Error(t("room.adminUnavailable"))
        await send("source-request", { command }, view.adminId)
      }
    }
    reportSource = async readiness => {
      if (!view.ready || readiness.revision !== sourceRevision(view.shared)) return
      view.sourceReadiness[selfId] = readiness
      if (isAdmin) await snapshot()
      else if (view.adminId) await send("source-ready", { readiness }, view.adminId)
    }
    manageMember = async command => {
      if (!isAdmin || !policy || epoch !== generation) throw new Error(t("room.adminOnlyAdmission"))
      const key = command.kind === "readmit" ? command.publicKey : authenticated.get(command.peerId)
      if (!key || key === current.adminKey) throw new Error(t("room.unavailableMember"))
      if (command.kind === "remove" && !isAdmitted(policy, key)) throw new Error(t("room.notAdmitted"))
      if (command.kind === "remove") {
        const nickname = view.participantNames?.[command.peerId]
        if (validNickname(nickname)) vault.removedNames = [...(vault.removedNames || []).filter(n => n.roomId !== current.roomId || n.publicKey !== key), { roomId: current.roomId, publicKey: key, nickname }].slice(-4096)
      }
      if (command.kind === "readmit" && !policy.blocked.includes(key)) throw new Error(t("room.notBlocked"))
      const allowed = policy.allowed.filter(k => k !== key), blocked = policy.blocked.filter(k => k !== key)
      if (command.kind === "remove") blocked.push(key)
      else allowed.push(key)
      if (allowed.length > 128 || blocked.length > 128) throw new Error(t("room.memberLimit"))
      const data = { ...policy, revision: policy.revision + 1, approvalRequired: policy.approvalRequired || command.kind === "remove", allowed, blocked }
      const next = { ...data, signature: await sign(identity, policyText(data)) }
      await publishPolicy(next)
      await snapshot()
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
      if (m.version !== 5) { view.error = t("room.incompatibleProtocol"); return }
      if (m.roomId !== current.roomId || typeof m.id !== "string" || m.id.length > 64 || !Number.isSafeInteger(m.sequence)) return
      const ids = seen.get(peerId) || []
      if (ids.includes(m.id)) return
      seen.set(peerId, [...ids.slice(-127), m.id])
      // Handshake/bootstrap messages have their own checks below. All future
      // shared commands must pass this membership gate, including mesh traffic.
      if (!["challenge", "proof", "hello", "policy", "snapshot", "ended"].includes(String(m.kind)) &&
        !canAcceptMemberCommand(policy, authenticated.get(peerId), peerId, view.participants, view.ready)) return
      if (typeof m.kind === "string" && m.kind.startsWith("pb-")) {
        await playbackSession?.receive(m.kind, m, peerId, authenticated.get(peerId) === current.adminKey)
        return
      }
      if (m.kind === "source-request" && isAdmin && validRoomCommand(m.command) && m.command.kind === "source") {
        try { await acceptSource(m.command, peerId) }
        catch (error) { await send("source-rejected", { error: error instanceof Error ? error.message : t("room.sourceRejected") }, peerId) }
      }
      if (m.kind === "source-rejected" && authenticated.get(peerId) === current.adminKey && typeof m.error === "string") view.error = m.error.slice(0, 200)
      if (m.kind === "source-ready" && isAdmin && validReadiness(m.readiness) && m.readiness.revision === sourceRevision(view.shared)) {
        view.sourceReadiness[peerId] = m.readiness
        await snapshot()
      }
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
        if (validNickname(m.nickname)) view.participantNames = { ...view.participantNames, [peerId]: m.nickname }
        if (m.publicKey === current.adminKey) { view.adminId = peerId; lastAdminSeen = now }
        if (isAdmin) {
          if (policy && !policy.approvalRequired && !policy.blocked.includes(m.publicKey) && !isAdmitted(policy, m.publicKey) && policy.allowed.length < 128) {
            const data = { ...policy, revision: policy.revision + 1, allowed: [...policy.allowed, m.publicKey] }
            await publishPolicy({ ...data, signature: await sign(identity, policyText(data)) })
          }
          await snapshot()
        }
        else await send("hello", {}, peerId)
      }
      if (m.kind === "hello" && authenticated.has(peerId)) {
        if (validNickname(m.nickname)) view.participantNames = { ...view.participantNames, [peerId]: m.nickname }
        if (isAdmin) await snapshot(peerId)
        const ended = vault.ended.find(c => c.roomId === current.roomId && c.adminKey === current.adminKey)
        if (ended) await send("ended", { certificate: ended }, peerId)
      }
      if (m.kind === "policy" && validPolicy(m.policy) && m.policy.roomId === current.roomId && m.policy.adminKey === current.adminKey && (!policy || m.policy.revision >= policy.revision) && await verify(current.adminKey, m.policy.signature, policyText(m.policy))) {
        if (!await publishPolicy(m.policy)) return
      }
      if (m.kind === "snapshot" && authenticated.get(peerId) === current.adminKey && isAdmitted(policy, identity.publicKey) && m.policyRevision === policy?.revision && validShared(m.shared) && Array.isArray(m.participants) && m.participants.length <= 100 && m.participants.every(p => typeof p === "string" && p.length <= 128) && m.memberKeys && typeof m.memberKeys === "object" && m.participants.every(id => isAdmitted(policy, (m.memberKeys as Record<string, string>)[id]))) {
        if (sourceRevision(m.shared) < sourceRevision(view.shared)) return
        memberKeys = m.memberKeys as Record<string, string>
        lastAdminSeen = now
        retryDelay = 30000
        nextRetry = now + retryDelay
        view = { ...view, ready: true, status: "connected", adminId: peerId, error: null, shared: m.shared, participants: [...new Set([selfId, peerId, ...m.participants])] }
        const names = m.participantNames
        view.participantNames = Object.fromEntries(view.participants.flatMap(id => {
          const name = names && typeof names === "object" && Object.hasOwn(names, id) ? (names as Record<string, unknown>)[id] : undefined
          return validNickname(name) ? [[id, name]] : []
        }))
        if (vault.nickname) view.participantNames[selfId] = vault.nickname
        await playbackSession?.acceptSnapshot(m.playbackState)
        if (m.sourceReadiness && typeof m.sourceReadiness === "object") view.sourceReadiness = Object.fromEntries(Object.entries(m.sourceReadiness).filter(([id, state]) => view.participants.includes(id) && validReadiness(state) && state.revision === sourceRevision(view.shared)))
        await save()
        notifySource()
      }
      if (m.kind === "policy" && !isAdmin && authenticated.get(peerId) === current.adminKey && !isAdmitted(policy, identity.publicKey)) {
        lastAdminSeen = now
        view.ready = false; view.error = t("room.waitingApproval")
      }
      if (m.kind === "ended" && validCertificate(m.certificate)) {
        // A signed certificate can safely be forwarded by any peer.
        await applyEnd(m.certificate)
      }
    }
    action.onMessage = (value, { peerId }) => { void serialized(() => receive(value, peerId)).catch(error => { view.error = error instanceof Error ? error.message : t("room.messageError") }) }
    transport.onPeerJoin = peerId => { void serialized(async () => {
      if (epoch === generation) await challenge(peerId)
    }).catch(() => { view.error = t("room.authenticationFailed") }) }
    transport.onPeerLeave = peerId => {
      void serialized(async () => {
        if (epoch !== generation) return
        authenticated.delete(peerId); challenges.delete(peerId); rates.delete(peerId); seen.delete(peerId)
        if (view.adminId === peerId) { view.adminId = null; view.ready = false; view.status = "reconnecting"; view.error = t("room.waitingReturn"); notifySource() }
        if (isAdmin) await snapshot()
      }).catch(() => {})
    }
    timer = setInterval(() => { void serialized(async () => {
      if (epoch !== generation) return
      if (isAdmin) await snapshot()
      else {
        if (view.adminId) await send("hello", {}, view.adminId)
        if (Date.now() - lastAdminSeen > 15000) { view.ready = false; view.status = "reconnecting"; view.error = t("room.waitingReturn"); notifySource() }
        if (!view.ready && view.error !== t("room.waitingApproval") && Date.now() >= nextRetry) {
          // Trystero retries signaling too; periodic rebuild recovers stale transports.
          await connect(Math.min(retryDelay * 2, 300000))
        }
      }
    }).catch(error => { view.error = error instanceof Error ? error.message : t("room.connectionError") }) }, 5000)
  } catch (error) {
    await disconnect()
    view = { ...view, ready: false, sync: undefined, status: "error", error: error instanceof Error ? error.message : t("room.joinError") }
  }
  notifySource()
}

export function initializeRoom() {
  if (!initialized) initialized = (async () => {
    vault = validateVault(await vaultRequest("read"))
    view.nickname = vault.nickname
    if (!vault.identity) { vault.identity = await createIdentity(); await vaultRequest("write", vault) }
    if (!await validateIdentity(vault.identity)) throw new Error(t("room.corruptKeys"))
    for (const policy of vault.policies || []) {
      if (!await verify(policy.adminKey, policy.signature, policyText(policy))) throw new Error(t("room.corruptPolicy"))
    }
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
    if (command.kind === "nickname") {
      if (!validNickname(command.nickname)) throw new Error(t("room.invalidNickname"))
      vault.nickname = command.nickname
      await save()
    }
    if (command.kind === "status") notifySource()
    if (command.kind === "status" && invite && !room) await connect(60000)
    if (command.kind === "leave") {
      await disconnect(); invite = undefined; view = { ...idle(), nickname: vault.nickname }; await save(); notifySource()
    }
    if (command.kind === "create" || command.kind === "join") {
      if (invite) throw new Error(t("room.leaveFirst"))
      const next: Invitation = command.kind === "create" ? { version: 2, roomId: randomToken(), secret: randomToken(), adminKey: vault.identity!.publicKey } : decodeInvitation(command.invitation.trim())
      if (vault.ended.some(c => c.roomId === next.roomId && c.adminKey === next.adminKey)) throw new Error(t("room.alreadyEnded"))
      if (command.nickname !== undefined) {
        if (!validNickname(command.nickname)) throw new Error(t("room.invalidNickname"))
        vault.nickname = command.nickname
      }
      invite = next
      view.shared = command.kind === "create" ? command.initial || empty() : empty()
      await save()
      await connect()
    }
    if (command.kind === "retry") await connect()
    if (command.kind === "source") {
      if (!changeSource || !validRoomCommand(command)) throw new Error(t("room.sourceUnavailable"))
      await changeSource(command)
    }
    if (command.kind === "source-ready" && reportSource) await reportSource(command.readiness)
    if (command.kind === "playback") {
      if (!playbackSession || !view.shared.video) throw new Error(t("room.choosePlayer"))
      await playbackSession.request(command.request)
    }
    if (command.kind === "player-report") await playbackSession?.player(command.report)
    if (command.kind === "remove" || command.kind === "approve" || command.kind === "readmit") {
      if (!view.isAdmin || !manageMember) throw new Error(t("room.adminOnlyMembers"))
      await manageMember(command)
    }
    if (command.kind === "end") {
      if (!invite || !view.isAdmin) throw new Error(t("room.adminOnlyEnd"))
      const data = { roomId: invite.roomId, adminKey: invite.adminKey, endedAt: Date.now() }
      const certificate = { ...data, signature: await sign(vault.identity!, endText(data)), invitation: encodeInvitation(invite) }
      // Persist before transmission; never reopen a room if delivery is interrupted.
      vault.ended.push(certificate)
      await vaultRequest("write", vault)
      try { await sendMessage?.("ended", { certificate }) } finally { await applyEnd(certificate) }
    }
    return structuredClone({ ...view, nickname: vault.nickname })
  })
}
