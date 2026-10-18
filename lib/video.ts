export type VideoDescriptor = {
  pageUrl: string
  frameUrl: string
  framePath: string[]
  shadowPath: string[]
  selector: string
  source: string
  duration: number | null
}
export type VideoInfo = {
  position: number
  playbackRate: number
  id: string
  label: string
  width: number
  height: number
  duration: number | null
  readyState: number
  paused: boolean
  poster: string
  descriptor: VideoDescriptor
}
export type VideoSnapshot = {
  roomBinding?: { roomId: string; revision: number; videoId: string }
  notice?: string
  videos: VideoInfo[]
  selectedId: string | null
  binding: "none" | "bound" | "missing" | "ambiguous"
}
export type VideoAction =
  | { kind: "list" }
  | { kind: "pick"; shared?: { roomId: string; revision: number } }
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "select"; id: string }
  | { kind: "highlight"; id: string | null }
export type TabVideos = {
  frames: { frameId: number; url: string; snapshot: VideoSnapshot }[]
  unavailableFrames: number
}
