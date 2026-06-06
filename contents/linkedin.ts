export const config = {
  matches: ["https://www.linkedin.com/*"]
}

// ── Job context ───────────────────────────────────────────────────────────────
// Find the heading whose ancestor also contains a /company/ link — this
// guarantees we have the right detail panel, not a random h1 elsewhere.

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

  for (const tag of ["h1", "h2"] as const) {
    for (const el of document.querySelectorAll<HTMLElement>(tag)) {
      if (el.closest("header, nav, [role='banner']")) continue
      const text = el.textContent?.trim() || ""
      if (text.length < 2 || text.length > 200) continue

      // Walk up until we find an ancestor that also holds a company link
      let container: Element | null = el
      for (let i = 0; i < 10; i++) {
        container = container?.parentElement ?? null
        if (!container || container === document.body) break
        if (container.querySelector('a[href*="/company/"]')) {
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

// Company name links are short and don't contain action words
function isCompanyNameText(text: string): boolean {
  return (
    text.length > 0 &&
    text.length < 80 &&
    !/\b(jobs|follow|connect|see all|view|visit|about|message|report)\b/i.test(text)
  )
}

function getCompany(): string {
  const ctx = getCtx()
  const scope = ctx?.container ?? document

  const match = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]'))
    .map(a => a.textContent?.trim() || "")
    .find(isCompanyNameText)

  return match || ""
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
    .filter(t => t.length > 0 && t.length < 200 && salaryPattern.test(t))

  return candidates[0]?.replace(/\s+/g, " ").trim() || ""
}

function getRecruiterName(): string {
  const hiringSection =
    document.querySelector("[aria-label*='hiring']") ||
    document.querySelector("[aria-label*='poster']") ||
    document.querySelector("[data-test*='recruiter']") ||
    Array.from(document.querySelectorAll("section, div")).find(el =>
      /meet.*hiring team|hiring team/i.test(el.textContent || "")
    )

  if (!hiringSection) return ""

  const name = Array.from(hiringSection.querySelectorAll("span, a"))
    .map(el => el.textContent?.trim() || "")
    .find(t =>
      t.length > 2 &&
      t.length < 60 &&
      !/connect|message|follow|view/i.test(t)
    )

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
