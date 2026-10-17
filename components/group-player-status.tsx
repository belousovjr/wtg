import type { RoomView } from "../lib/room-protocol"
import { groupPlayerStatus } from "../lib/group-status"

export function GroupPlayerStatus({ room, remove, busy }: { room: RoomView; remove?: (id: string) => void; busy?: boolean }) {
  const group = groupPlayerStatus(room)
  return <section aria-label="Привязка плееров группы" style={{ padding: 12, margin: "12px 0", borderRadius: 8,
    border: `2px solid ${group.allReady ? "#15803d" : "#a16207"}`, background: group.allReady ? "#f0fdf4" : "#fffbeb", color: "#111827" }}>
    <strong role="status">{!room.ready ? "Нет связи с координатором" : !room.shared.video ? "Видео для группы ещё не выбрано" : group.allReady ? `✓ Плееры привязаны у всех (${group.total} из ${group.total})` : `Плеер привязан у ${group.bound} из ${group.total} участников`}</strong>
    <ul style={{ paddingLeft: 20, marginBottom: 0 }}>{group.members.map(member => <li key={member.id}>
      <strong>{member.id === room.selfId ? "Ты" : `Участник ${member.id.slice(0, 6)}`}{member.id === room.adminId ? " · админ" : ""}</strong>: {member.text}
      {room.isAdmin && member.id !== room.selfId && remove && <details><summary>Действия</summary><button disabled={busy} onClick={() => remove(member.id)}>Удалить участника</button></details>}
    </li>)}</ul>
    {room.shared.video && !group.allReady && <p style={{ marginBottom: 0 }}>Общий выбор сохранён. Зелёный статус появится, когда плееры будут привязаны и готовы у всех.</p>}
  </section>
}
