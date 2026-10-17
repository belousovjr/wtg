import type { VideoDescriptor } from "./video"

type Root = Document | ShadowRoot
export function videosIn(root: Root = document): HTMLVideoElement[] {
  const found = [...root.querySelectorAll("video")]
  for (const node of root.querySelectorAll("*")) {
    if (node.shadowRoot) found.push(...videosIn(node.shadowRoot))
  }
  return found
}

export function selectorFor(element: Element, root: Root): string {
  const unique = (selector: string) => {
    const matches = root.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  }
  if (element.id) {
    const selector = `#${CSS.escape(element.id)}`
    if (unique(selector)) return selector
  }
  for (const name of ["data-testid", "data-player-id", "name", "aria-label"]) {
    const value = element.getAttribute(name)
    if (!value) continue
    const selector = `${element.localName}[${name}="${CSS.escape(value)}"]`
    if (unique(selector)) return selector
  }
  let node: Element | null = element
  let path = ""
  while (node) {
    const siblings = node.parentElement ? [...node.parentElement.children] : [...root.children]
    const index = siblings.filter(s => s.localName === node!.localName).indexOf(node) + 1
    path = `${node.localName}:nth-of-type(${index})${path ? ` > ${path}` : ""}`
    if (unique(path)) return path
    node = node.parentElement
  }
  throw new Error("Не удалось построить уникальный селектор")
}

export function describe(video: HTMLVideoElement): VideoDescriptor {
  const shadowPath: string[] = []
  let root = video.getRootNode() as Root
  const selector = selectorFor(video, root)
  while (root instanceof ShadowRoot) {
    const host = root.host
    root = host.getRootNode() as Root
    shadowPath.unshift(selectorFor(host, root))
  }
  return {
    pageUrl: location.href, frameUrl: location.href, framePath: [], shadowPath,
    selector, source: video.currentSrc || video.src,
    duration: Number.isFinite(video.duration) ? video.duration : null
  }
}

export function resolve(descriptor: VideoDescriptor): HTMLVideoElement[] {
  let root: Root = document
  try {
    for (const selector of descriptor.shadowPath) {
      const hosts = root.querySelectorAll(selector)
      if (hosts.length !== 1 || !hosts[0].shadowRoot) return []
      root = hosts[0].shadowRoot
    }
    return [...root.querySelectorAll(descriptor.selector)].filter((node): node is HTMLVideoElement => {
      if (!(node instanceof HTMLVideoElement)) return false
      if (descriptor.source && descriptor.source !== (node.currentSrc || node.src)) return false
      return descriptor.duration === null || !Number.isFinite(node.duration) || Math.abs(node.duration - descriptor.duration) < 1
    })
  } catch { return [] }
}
