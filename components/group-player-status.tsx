import type { RoomView } from "../lib/room-protocol"
import { groupPlayerStatus } from "../lib/group-status"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Avatar, AvatarFallback } from "./ui/avatar"
import { Check, Users, UserMinus } from "lucide-react"

export function GroupPlayerStatus({ room, remove, busy }: { room: RoomView; remove?: (id: string) => void; busy?: boolean }) {
  const group = groupPlayerStatus(room)
  return <Card size="sm" aria-label="Привязка плееров группы">
    <CardHeader className="flex flex-row items-center justify-between">
      <CardTitle className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" />Участники <Badge variant="secondary">{group.total}</Badge></CardTitle>
      {room.isAdmin && room.shared.video && group.synchronized < group.total && <Badge variant="outline" aria-label={`Синхронизированы ${group.synchronized} из ${group.total}`}>{group.synchronized}/{group.total}</Badge>}
      {group.allReady && <Badge variant="secondary"><Check className="size-3" />Готовы</Badge>}
    </CardHeader>
    <CardContent className="space-y-3">
      <p role="status" className="text-xs text-muted-foreground">{!room.ready ? "Нет связи с координатором" : !room.shared.video ? "Выбери видео для группы" : group.allReady ? "Плееры привязаны у всех" : `Плеер привязан у ${group.bound} из ${group.total}`}</p>
      {group.members.map(member => <div key={member.id} className="flex items-center gap-2.5">
        <Avatar className="size-8"><AvatarFallback className="text-xs">{member.id === room.selfId ? "Я" : member.id.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-medium">{member.id === room.selfId ? "Ты" : `Участник ${member.id.slice(0, 6)}`}{member.id === room.adminId && <Badge variant="outline" className="text-[10px]">Админ</Badge>}</div>
          <p className="text-xs text-muted-foreground">{member.text}</p>
        </div>
        {room.isAdmin && member.id !== room.selfId && remove && <Button variant="ghost" size="icon-sm" aria-label="Удалить участника" title="Удалить участника" disabled={busy} onClick={() => remove(member.id)}><UserMinus className="size-3.5" /></Button>}
      </div>)}
    </CardContent>
  </Card>
}
