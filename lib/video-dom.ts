import { t } from "./i18n"
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
  throw new Error(t("videoDom.selectorFailed"))
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

function compatibleSource(expected: string, actual: string, shared: boolean) {
  if (!expected || expected === actual) return true
  if (!shared) return false
  // Object URLs identify a browser-local MediaSource, not a shared movie.
  if (expected.startsWith("blob:") || actual.startsWith("blob:") || !actual) return true
  try {
    const a = new URL(expected), b = new URL(actual)
    // Signed/tokenized variants of the same media resource are session-specific.
    return a.protocol === "https:" && b.protocol === "https:" && a.origin === b.origin && a.pathname === b.pathname
  } catch { return false }
}
export function resolve(descriptor: VideoDescriptor, options: { shared?: boolean } = {}): HTMLVideoElement[] {
  let root: Root = document
  try {
    for (const selector of descriptor.shadowPath) {
      const hosts = root.querySelectorAll(selector)
      if (hosts.length !== 1 || !hosts[0].shadowRoot) return []
      root = hosts[0].shadowRoot
    }
    const candidates = [...root.querySelectorAll(descriptor.selector)]
    if (options.shared && candidates.length !== 1) return []
    return candidates.filter((node): node is HTMLVideoElement => {
      if (!(node instanceof HTMLVideoElement)) return false
      if (!compatibleSource(descriptor.source, node.currentSrc || node.src, !!options.shared)) return false
      return descriptor.duration === null || !Number.isFinite(node.duration) || Math.abs(node.duration - descriptor.duration) < 1
    })
  } catch { return [] }
}
