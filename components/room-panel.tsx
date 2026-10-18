import { useEffect, useState } from "react"
import { CHANNEL, sendRequest } from "../lib/messages"
import type { RoomCommand, RoomView, SharedState } from "../lib/room-protocol"
import type { TabVideos } from "../lib/video"
import { LoadingStatus } from "./loading-status"
import { SourceControls } from "./source-controls"
import { VideoPicker } from "./video-picker"
import { GroupPlayerStatus } from "./group-player-status"
import { Button } from "./ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card"
import { Badge } from "./ui/badge"
import { Textarea } from "./ui/textarea"
import { Label } from "./ui/label"
import { Alert, AlertDescription } from "./ui/alert"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./ui/accordion"
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "./ui/alert-dialog"
import { Copy, Check, Plus, LogIn, LogOut, RotateCw, ShieldCheck, UserCheck } from "lucide-react"

const labels: Record<RoomView["status"], string> = {
  idle: "Не в комнате", waiting: "Ожидание участников", connected: "Подключено",
  reconnecting: "Ожидание администратора", error: "Ошибка соединения"
}
export function RoomPanel() {
  const [room, setRoom] = useState<RoomView>()
  const [invitation, setInvitation] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const request = (command: RoomCommand) => sendRequest<RoomView>({ channel: CHANNEL, to: "background", type: "room", command })
  useEffect(() => {
    let active = true
    const poll = () => void request({ kind: "status" }).then(view => { if (active) setRoom(view) }, cause => { if (active) setError(String(cause)) })
    poll()
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  async function perform(command: RoomCommand) {
    setBusy(true)
    setError("")
    setCopied(false)
    try { setRoom(await request(command)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка комнаты") }
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
        const selected = videos.frames.flatMap(frame => frame.snapshot.videos.filter(video => video.id === frame.snapshot.selectedId))[0]
        if (selected) initial = { url: selected.descriptor.pageUrl, video: selected.descriptor, playback: { position: selected.position, paused: selected.paused, rate: selected.playbackRate } }
      }
      setRoom(await request({ kind: "create", initial }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать комнату") }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(room!.invitation!); setCopied(true); setCopyFailed(false) }
    catch { setCopyFailed(true); setError("Не удалось скопировать. Скопируй приглашение из поля ниже.") }
  }
  return <section className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Комната</h2>{room?.isAdmin && room.status !== "idle" && <Badge variant="outline"><ShieldCheck className="size-3" />Администратор</Badge>}</div>
    {!room || busy ? <LoadingStatus>{!room ? "Загружаем комнату…" : "Подождите…"}</LoadingStatus> :
      room.status !== "idle" && !room.ready && room.status === "waiting" ?
        <LoadingStatus>Подключаемся к комнате…</LoadingStatus> :
        <Badge variant={room.status === "error" ? "destructive" : "secondary"} role="status">{labels[room.status]}</Badge>}
    {room?.status === "idle" && !busy ? <>
      <Card><CardHeader><CardTitle>Смотреть вместе</CardTitle><CardDescription>Создай комнату или присоединись по приглашению.</CardDescription></CardHeader><CardContent className="space-y-4">
        <Button className="w-full" disabled={busy} onClick={create}><Plus />Создать комнату</Button>
        <div className="space-y-2"><Label htmlFor="invitation">Приглашение</Label><Textarea id="invitation" value={invitation} onChange={e => setInvitation(e.target.value)} placeholder="wtg2.…" className="min-h-20 resize-none text-xs" /></div>
        <Button variant="outline" className="w-full" disabled={busy || !invitation.trim()} onClick={() => void perform({ kind: "join", invitation })}><LogIn />Присоединиться</Button>
      </CardContent></Card>
    </> : room && room.status !== "idle" && <>
      {room.ready && <>
      <GroupPlayerStatus room={room} busy={busy} remove={id => void perform({ kind: "remove", peerId: id })} />
      {room.isAdmin && room.approvalRequired && <p className="text-xs text-muted-foreground">Новые участники входят после твоего подтверждения.</p>}
      {room.isAdmin && room.pendingParticipants.length > 0 && <Card size="sm"><CardHeader><CardTitle>Ожидают допуска</CardTitle></CardHeader><CardContent className="space-y-2">
        {room.pendingParticipants.map(member => <div className="flex items-center justify-between gap-2" key={member.peerId}><span className="font-mono text-xs">{member.peerId.slice(0, 8)}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform({ kind: "approve", peerId: member.peerId })}><UserCheck />Разрешить вход</Button>
        </div>)}
      </CardContent></Card>}
      {room.isAdmin && room.blockedKeys.length > 0 && <Card size="sm"><CardHeader><CardTitle>Удалённые участники <Badge variant="secondary">{room.blockedKeys.length}</Badge></CardTitle></CardHeader><CardContent className="space-y-2">
        {room.blockedKeys.map(key => <div className="flex items-center justify-between gap-2" key={key}><span className="font-mono text-xs">{key.slice(0, 12)}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform({ kind: "readmit", publicKey: key })}>Разрешить снова</Button>
        </div>)}
      </CardContent></Card>}
      {copyFailed && <Textarea aria-label="Приглашение комнаты" readOnly value={room.invitation || ""} className="text-xs" />}
      <Button className="w-full" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Скопировано" : "Пригласить"}</Button>
      </>}
      <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform({ kind: "leave" })}><LogOut />Выйти</Button>
      {room.isAdmin && <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={busy}>Завершить комнату</Button></AlertDialogTrigger>
        <AlertDialogContent className="max-w-[360px]"><AlertDialogHeader><AlertDialogTitle>Завершить комнату?</AlertDialogTitle><AlertDialogDescription>Совместный просмотр закончится для всех участников. Это действие нельзя отменить.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void perform({ kind: "end" })}>Завершить</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>}
      </div>
      {(room.status === "error" || room.status === "reconnecting") && <Button variant="outline" disabled={busy} onClick={() => void perform({ kind: "retry" })}><RotateCw />Повторить подключение</Button>}
      {room.ready && <SourceControls room={room} />}
      {room.ready && <VideoPicker />}
      {room.ready && <Accordion type="single" collapsible><AccordionItem value="sync" className="border-0"><AccordionTrigger className="text-xs text-muted-foreground">Диагностика синхронизации</AccordionTrigger><AccordionContent className="space-y-2 text-xs text-muted-foreground">
        <p>{room.sync?.preparation ? "Подготовка общего запуска" : room.sync?.command ? room.sync.command.paused ? "Общая пауза" : "Общий таймлайн воспроизведения" : "Ожидаем команды плеера"}</p>
        {room.sync?.clock && <p>RTT {Math.round(room.sync.clock.rtt)} мс · неопределённость ±{Math.round(room.sync.clock.uncertainty)} мс</p>}
      </AccordionContent></AccordionItem></Accordion>}
    </>}
    {(error || room?.error) && <Alert variant="destructive"><AlertDescription>{error || room?.error}</AlertDescription></Alert>}
  </section>
}
