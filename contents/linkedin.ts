export const config = {
  matches: ["https://www.linkedin.com/*"]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getJobTitleEl(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>("h1"))
    .find(el => !el.closest("header, nav, [role='banner']")) ?? null
}

// Walk up from h1 until the container is wide enough to hold job metadata
// but not so large it spans the whole page. Stops at depth 6.
function getJobHeaderContainer(): Element | null {
  const h1 = getJobTitleEl()
  if (!h1) return null

  let el: Element | null = h1
  for (let i = 0; i < 6; i++) {
    const parent = el?.parentElement
    if (!parent) break
    el = parent
    // Stop when we have at least 3 child elements (title + company + location)
    if (el.children.length >= 3) return el
  }
  return el
}

// ── Scrapers ─────────────────────────────────────────────────────────────────

function getJobTitle(): string {
  return getJobTitleEl()?.textContent?.trim().replace(/\s+/g, " ") || ""
}

function getCompany(): string {
  const container = getJobHeaderContainer()

  // Prefer a /company/ link scoped to the header area
  if (container) {
    const link = container.querySelector<HTMLAnchorElement>('a[href*="/company/"]')
    if (link?.textContent?.trim()) return link.textContent.trim()
  }

  // Page-wide fallback — still better than class names
  const link = document.querySelector<HTMLAnchorElement>('a[href*="/company/"]')
  return link?.textContent?.trim() || ""
}

function getLocation(): string {
  const locationPattern = /\b(remote|hybrid|on.?site)\b|[\p{L}\s][\p{L}\s]+,\s*[\p{L}]/iu

  // Prefer searching within the header container — avoids false hits from JD text
  const container = getJobHeaderContainer()
  if (container) {
    const candidates = Array.from(container.querySelectorAll("span, li, div"))
      .filter(el => !el.querySelector("h1") && !el.querySelector("a"))
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

// ── SPA navigation detection ─────────────────────────────────────────────────

let lastUrl = location.href
let lastJobId = new URLSearchParams(location.search).get("currentJobId")

function onUrlChange() {
  const currentUrl = location.href
  const currentJobId = new URLSearchParams(location.search).get("currentJobId")

  if (currentUrl !== lastUrl || currentJobId !== lastJobId) {
    lastUrl = currentUrl
    lastJobId = currentJobId
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

// ── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getJobData") {
    let attempts = 0
    const tryGetData = () => {
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
