export const config = {
  matches: ["https://www.linkedin.com/*"]
}

// ── Job context ───────────────────────────────────────────────────────────────
// Find the heading + its containing panel without relying on company link presence.

interface JobContext {
  titleEl: HTMLElement
  container: Element
}

let _ctx: JobContext | null | undefined = undefined

function clearCtx() {
  _ctx = undefined
}

function getCtx(): JobContext | null {
  if (_ctx !== undefined) return _ctx

  // Priority 1: use currentJobId to anchor directly to the detail panel.
  // LinkedIn always puts a /jobs/view/{id} link in the detail panel header —
  // this is far more reliable than scanning for h1/h2 on pages that have
  // unrelated headings like "Top job picks for you" on collections pages.
  const jobId = new URLSearchParams(location.search).get("currentJobId")
  if (jobId) {
    // The left-panel job list also contains /jobs/view/{id} links for the
    // selected job — those are inside <li> elements. The detail panel link
    // is NOT inside a list item, so skip anything inside <li>.
    const allJobLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(`a[href*="/jobs/view/${jobId}"]`)
    )
    const detailLink = allJobLinks.find(a => !a.closest("li")) ?? allJobLinks[0]

    if (detailLink) {
      // Title: walk UP from the link — the link is either wrapped in an h1/h2
      // or its own text IS the title. Never use container.querySelector("h1")
      // which can match unrelated headings like "About CompanyName".
      const titleEl: HTMLElement =
        detailLink.closest<HTMLElement>("h1, h2") ??
        (detailLink as unknown as HTMLElement)

      if (titleEl.textContent?.trim()) {
        let container: Element | null = titleEl
        for (let i = 0; i < 10; i++) {
          container = container?.parentElement ?? null
          if (!container || container === document.body) break
          if (container.querySelector('a[href*="/company/"]')) {
            _ctx = { titleEl, container }
            return _ctx
          }
        }
      }
    }
  }

  // Priority 2: direct job view pages — h1/h2 with a company link in its ancestor
  for (const tag of ["h1", "h2"] as const) {
    for (const el of document.querySelectorAll<HTMLElement>(tag)) {
      if (el.closest("header, nav, [role='banner']")) continue
      const text = el.textContent?.trim() || ""
      if (text.length < 2 || text.length > 200) continue

      let container: Element | null = el
      for (let i = 0; i < 10; i++) {
        container = container?.parentElement ?? null
        if (!container || container.tagName === "MAIN" || container === document.body) break

        const hasCompanyLink = !!container.querySelector('a[href*="/company/"]')
        const hasEnoughChildren = container.children.length >= 3

        if (hasCompanyLink || (i >= 2 && hasEnoughChildren)) {
          _ctx = { titleEl: el, container }
          return _ctx
        }
      }
    }
  }

  _ctx = null
  return null
}

// ── Scrapers ──────────────────────────────────────────────────────────────────

function getJobTitle(): string {
  return getCtx()?.titleEl.textContent?.trim().replace(/\s+/g, " ") || ""
}

function getCompany(): string {
  const ctx = getCtx()
  if (!ctx) return ""

  const { titleEl, container } = ctx
  const titleText = titleEl.textContent?.trim() || ""

  // 1. Company link — skip purely-action text (whole string match only)
  const actionRe = /^(follow|connect|message|see all jobs?|view profile|visit|about this company|report this job)$/i
  const countRe = /^\d[\d,.]*\s+(jobs?|followers?|employees?)/i

  const linkMatch = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]'))
    .map(a => a.textContent?.trim() || "")
    .find(t => t.length > 0 && t.length < 80 && !actionRe.test(t) && !countRe.test(t))

  if (linkMatch) return linkMatch

  // 2. Plain text fallback — walk text nodes inside the container.
  //    Company name is typically the first short text that is not the title,
  //    not a location, and not metadata noise.
  const locationRe = /\b(remote|hybrid|on.?site)\b|[\p{L}][\p{L}\s\-]+,\s*[\p{L}]/iu
  const metaRe = /\d+\s*(applicant|follower|employee|hour|day|week|month|year|minute)|\b(apply|easy apply|save|share|promoted|reposted|actively recruiting)\b/i

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node.textContent?.trim() || ""
    if (
      t.length > 1 &&
      t.length < 80 &&
      t !== titleText &&
      !locationRe.test(t) &&
      !metaRe.test(t) &&
      !(node.parentElement?.closest("h1, h2, button, [role='button']"))
    ) {
      return t
    }
  }

  return ""
}

function getLocation(): string {
  const locationPattern = /\b(remote|hybrid|on.?site)\b|[\p{L}\s][\p{L}\s]+,\s*[\p{L}]/iu

  const container = getCtx()?.container
  if (container) {
    const candidates = Array.from(container.querySelectorAll("span, li, div"))
      .filter(el => !el.querySelector("h1, h2") && !el.querySelector("a"))
      .map(el => el.textContent?.trim() || "")
      .filter(t => t.length > 3 && t.length < 80 && locationPattern.test(t))

    if (candidates.length > 0) {
      return candidates[0].replace(/\s+/g, " ").split("·")[0].split("(")[0].trim()
    }
  }

  // Fallback: broader scan of main content
  const panel = document.querySelector("main") || document.body
  const candidates = Array.from(panel.querySelectorAll("span, li"))
    .map(el => el.textContent?.trim() || "")
    .filter(t => t.length > 3 && t.length < 120 && locationPattern.test(t))

  return (candidates[0] || "").replace(/\s+/g, " ").split("·")[0].split("(")[0].trim()
}

function getSalary(): string {
  const salaryPattern =
    /[$€£¥₹][\d,.]+[kKmM]?|[\d,.]+\s*[kK]?\s*(\/yr|\/year|per year|annually|per month)/i

  const candidates = Array.from(document.querySelectorAll("span, div, li"))
    .map(el => el.textContent?.trim() || "")
    .filter(t => t.length > 0 && t.length < 80 && salaryPattern.test(t))

  return candidates[0]?.replace(/\s+/g, " ").trim() || ""
}

function getRecruiterName(): string {
  const hiringSection =
    document.querySelector("[aria-label*='hiring']") ||
    document.querySelector("[aria-label*='poster']") ||
    document.querySelector("[data-test*='recruiter']") ||
    Array.from(document.querySelectorAll("section, div")).find(el =>
      /meet.*hiring team|hiring team|people you can reach out to/i.test(el.textContent || "")
    )

  if (!hiringSection) return ""

  // Recruiter names are always linked to their /in/ profile — nav links never are
  const name = Array.from(hiringSection.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))
    .map(a => a.textContent?.trim() || "")
    .find(t => t.length > 2 && t.length < 60)

  return name || ""
}

function getJobData() {
  return {
    jobTitle: getJobTitle(),
    company: getCompany().replace(/\s+/g, " "),
    location: getLocation(),
    source: "LinkedIn",
    salary: getSalary(),
    recruiterName: getRecruiterName().replace(/\s+/g, " "),
  }
}

function getJobDescription(): string {
  const byId = document.querySelector("#job-details")
  if (byId?.textContent?.trim()) {
    return byId.textContent.trim().replace(/\s+/g, " ").substring(0, 3000)
  }

  const main = document.querySelector("main") || document.body
  const sections = Array.from(main.querySelectorAll("section, article, div"))
    .map(el => ({ el, text: el.textContent?.trim() || "" }))
    .filter(({ text }) => text.length > 300)
    .sort((a, b) => b.text.length - a.text.length)

  return sections[0]?.text.replace(/\s+/g, " ").substring(0, 3000) || ""
}

// ── SPA navigation detection ──────────────────────────────────────────────────

let lastUrl = location.href
let lastJobId = new URLSearchParams(location.search).get("currentJobId")

function onUrlChange() {
  const currentUrl = location.href
  const currentJobId = new URLSearchParams(location.search).get("currentJobId")

  if (currentUrl !== lastUrl || currentJobId !== lastJobId) {
    lastUrl = currentUrl
    lastJobId = currentJobId
    clearCtx()
    chrome.runtime.sendMessage({ action: "urlChanged", url: currentUrl }).catch(() => {})
  }
}

// Intercept both pushState and replaceState — LinkedIn uses both
const originalPushState = history.pushState.bind(history)
history.pushState = function (...args) {
  originalPushState(...args)
  onUrlChange()
}

const originalReplaceState = history.replaceState.bind(history)
history.replaceState = function (...args) {
  originalReplaceState(...args)
  onUrlChange()
}

window.addEventListener("popstate", onUrlChange)

// ── Message handlers ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getJobData") {
    let attempts = 0
    const tryGetData = () => {
      clearCtx()
      const data = getJobData()
      attempts++
      const hasData = data.jobTitle || data.company
      if (hasData || attempts >= 10) {
        sendResponse(data)
      } else {
        setTimeout(tryGetData, 500)
      }
    }
    tryGetData()
    return true
  }

  if (request.action === "getJobDescription") {
    let attempts = 0
    const tryGetDesc = () => {
      const jd = getJobDescription()
      attempts++
      if (jd || attempts >= 10) {
        sendResponse({ jobDescription: jd })
      } else {
        setTimeout(tryGetDesc, 500)
      }
    }
    tryGetDesc()
    return true
  }
})
