import { t } from "../lib/i18n"
import { useEffect, useState, useRef } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { RoomCommand, RoomView, SharedState } from "../lib/room-protocol"
import { onlyDiscoveredVideo, type TabVideos } from "../lib/video"
import { LoadingStatus } from "./loading-status"
import { SourceControls } from "./source-controls"
import { GroupPlayerStatus } from "./group-player-status"
import { Button } from "./ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card"
import { Badge } from "./ui/badge"
import { Textarea } from "./ui/textarea"
import { Label } from "./ui/label"
import { Input } from "./ui/input"
import { validNickname } from "../lib/room-protocol"
import { Alert, AlertDescription } from "./ui/alert"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog"
import { Copy, Check, Plus, LogIn, LogOut, RotateCw, UserCheck, Power } from "lucide-react"

export function RoomPanel() {
  const [room, setRoom] = useState<RoomView>()
  const [invitation, setInvitation] = useState("")
  const [nickname, setNickname] = useState("")
  const nicknameEdited = useRef(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const request = (command: RoomCommand) => sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command })
  function editNickname(value: string) {
    nicknameEdited.current = true
    setNickname(value)
    if (validNickname(value.trim())) void request({ kind: "nickname", nickname: value.trim() }).catch(cause => setError(cause instanceof Error ? cause.message : t("roomPanel.nicknameSaveFailed")))
  }
  useEffect(() => {
    let active = true
    const poll = () => void request({ kind: "status" }).then(view => { if (active) { setRoom(view); if (!nicknameEdited.current) setNickname(view.nickname || "") } }, cause => { if (active) setError(String(cause)) })
    poll()
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  async function perform(command: RoomCommand) {
    setBusy(true)
    setError("")
    setCopied(false)
    try { setRoom(await request(command)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("roomPanel.roomError")) }
    finally { setBusy(false) }
  }
  async function create() {
    setBusy(true)
    setError("")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      let initial: SharedState | undefined
      if (tab?.id !== undefined) {
        const videos = await sendRequest<TabVideos>({ channel: CHANNEL, to: "background", type: "tab-videos", tabId: tab.id })
        const selected = onlyDiscoveredVideo(videos)
        if (selected) {
          const url = tab.url || selected.descriptor.pageUrl
          initial = { url, video: { ...selected.descriptor, pageUrl: url }, playback: { position: selected.position, paused: true, rate: selected.playbackRate } }
        }
      }
      setRoom(await request({ kind: "create", initial, nickname: nickname.trim() }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("roomPanel.createFailed")) }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(room!.invitation!); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true); setError(t("roomPanel.clipboardFailed")) }
  }
  return <section className="space-y-4">
    {!room || busy ? <LoadingStatus>{!room ? t("roomPanel.loadingRoom") : t("roomPanel.pleaseWait")}</LoadingStatus> :
      room.status !== "idle" && !room.ready && room.status === "waiting" ?
        <LoadingStatus>{t("roomPanel.joining")}</LoadingStatus> :
        room.status === "reconnecting" ? <LoadingStatus>{t("roomPanel.waitingAdmin")}</LoadingStatus> :
        room.status === "error" && <Alert variant="destructive"><AlertDescription>{t("roomPanel.connectionError")}</AlertDescription></Alert>}
    {room?.status === "idle" && !busy ? <>
      <Card><CardHeader><CardTitle>{t("roomPanel.watchTogether")}</CardTitle><CardDescription>{t("roomPanel.intro")}</CardDescription></CardHeader><CardContent>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (busy || !validNickname(nickname.trim())) return; if (invitation.trim()) void perform({ kind: "join", invitation: invitation.trim(), nickname: nickname.trim() }); else void create() }}>
        <div className="space-y-2"><Label htmlFor="nickname">{t("roomPanel.nickname")}</Label><Input id="nickname" autoComplete="nickname" maxLength={32} value={nickname} onChange={e => editNickname(e.target.value)} placeholder={t("roomPanel.nicknamePlaceholder")} /></div>
        <div className="space-y-2"><Label htmlFor="invitation">{t("roomPanel.invitation")}</Label><Input id="invitation" value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="wtg2.…" autoComplete="off" spellCheck={false} className="text-xs" /></div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || !validNickname(nickname.trim())}>{invitation.trim() ? <LogIn /> : <Plus />}{invitation.trim() ? t("roomPanel.join") : t("roomPanel.create")}</Button>
        </div>
        </form>
      </CardContent></Card>
    </> : room && room.status !== "idle" && <>
      {room.ready && <>
      <SourceControls room={room} />
      <GroupPlayerStatus room={room} busy={busy} remove={id => void perform({ kind: "remove", peerId: id })} />
      {room.isAdmin && room.approvalRequired && <p className="text-xs text-muted-foreground">{t("roomPanel.approvalRequired")}</p>}
      {room.isAdmin && room.pendingParticipants.length > 0 && <Card size="sm"><CardHeader><CardTitle>{t("roomPanel.pending")}</CardTitle></CardHeader><CardContent className="space-y-2">
        {room.pendingParticipants.map(member => <div className="flex items-center justify-between gap-2" key={member.peerId}><span className="text-xs">{room.participantNames?.[member.peerId] || t("roomPanel.participant")}</span>
          <Button size="icon-sm" variant="outline" title={t("roomPanel.allow")} aria-label={t("roomPanel.allow")} disabled={busy} onClick={() => void perform({ kind: "approve", peerId: member.peerId })}><UserCheck /></Button>
        </div>)}
      </CardContent></Card>}
      {room.isAdmin && room.blockedKeys.length > 0 && <Card size="sm"><CardHeader><CardTitle>{t("roomPanel.removed")}<Badge variant="secondary">{room.blockedKeys.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">
        {room.blockedKeys.map(key => <div className="flex items-center justify-between gap-2" key={key}><span className="text-xs">{room.blockedNames?.[key] || t("roomPanel.unnamed")}</span>
          <Button size="icon-sm" variant="outline" title={t("roomPanel.allowAgain")} aria-label={t("roomPanel.allowAgain")} disabled={busy} onClick={() => void perform({ kind: "readmit", publicKey: key })}><UserCheck /></Button>
        </div>)}
      </CardContent></Card>}
      {copyFailed && <Textarea aria-label={t("roomPanel.invitationLabel")} readOnly value={room.invitation || ""} className="text-xs" />}
      </>}
      <div className="flex flex-wrap gap-2">
      {room.ready && <Button size="sm" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? t("roomPanel.copied") : t("roomPanel.invite")}</Button>}
      {!room.isAdmin && <Button variant="outline" size="icon-sm" title={t("roomPanel.leave")} aria-label={t("roomPanel.leave")} disabled={busy} onClick={() => void perform({ kind: "leave" })}><LogOut /></Button>}
      {room.isAdmin && <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="icon-sm" title={t("roomPanel.endForAll")} aria-label={t("roomPanel.endForAll")} disabled={busy}><Power /></Button></AlertDialogTrigger>
        <AlertDialogContent className="max-w-[360px]"><AlertDialogHeader><AlertDialogTitle>{t("roomPanel.endConfirm")}</AlertDialogTitle><AlertDialogDescription>{t("roomPanel.endWarning")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("roomPanel.cancel")}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void perform({ kind: "end" })}>{t("roomPanel.end")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
      {(room.status === "error" || room.status === "reconnecting") && <Button variant="outline" size="icon-sm" title={t("roomPanel.retry")} aria-label={t("roomPanel.retry")} disabled={busy} onClick={() => void perform({ kind: "retry" })}><RotateCw /></Button>}
      </div>
      {room.ready && <Accordion type="single" collapsible><AccordionItem value="sync" className="border-0"><AccordionTrigger className="text-xs text-muted-foreground">{t("roomPanel.diagnostics")}</AccordionTrigger><AccordionContent className="space-y-2 text-xs text-muted-foreground">
        <p>{room.sync?.preparation ? t("roomPanel.preparing") : room.sync?.command ? room.sync.command.paused ? t("roomPanel.paused") : t("roomPanel.playing") : t("roomPanel.waitingCommand")}</p>
        {room.sync?.clock && <p>{t("roomPanel.timing", { rtt: Math.round(room.sync.clock.rtt), uncertainty: Math.round(room.sync.clock.uncertainty) })}</p>}
      </AccordionContent></AccordionItem></Accordion>}
    </>}
    {(error || room?.error) && <Alert variant="destructive"><AlertDescription>{error || room?.error}</AlertDescription></Alert>}
  </section>
}
