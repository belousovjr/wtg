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
  videos: VideoInfo[]
  selectedId: string | null
  binding: "none" | "bound" | "missing" | "ambiguous"
}
export type VideoAction =
  | { kind: "list" }
  | { kind: "pick" }
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "select"; id: string }
  | { kind: "highlight"; id: string | null }
export type TabVideos = {
  frames: { frameId: number; url: string; snapshot: VideoSnapshot }[]
  unavailableFrames: number
}
