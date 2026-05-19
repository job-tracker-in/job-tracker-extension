export const config = {
  matches: ["https://www.linkedin.com/*"]
}

function getJobData() {
  // --- Job Title ---
  const jobTitle =
    document.querySelector('h1[class*="job-title"]')?.textContent?.trim() ||
    document.querySelector('h1[class*="topcard__title"]')?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__job-title")?.textContent?.trim() ||
    document.querySelector("h1.t-24")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    ""

  // --- Company ---
  const company =
    document.querySelector('[class*="company-name"] a')?.textContent?.trim() ||
    document.querySelector('[class*="company-name"]')?.textContent?.trim() ||
    document.querySelector('[class*="org-name-link"]')?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__company-name a")?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent?.trim() ||
    document.querySelector(".topcard__org-name-link")?.textContent?.trim() ||
    ""

  // --- Location ---
  const location =
    document.querySelector('[class*="bullet"]')?.textContent?.trim() ||
    document.querySelector('[class*="tertiary-description"] span')?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__tertiary-description-container span.tvm__text.tvm__text--low-emphasis")?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__primary-description-without-tagline span.tvm__text:first-child")?.textContent?.trim() ||
    document.querySelector(".job-details-jobs-unified-top-card__bullet")?.textContent?.trim() ||
    ""

  const cleanLocation = location.replace(/\s+/g, " ").trim().split("·")[0].trim()

  // --- Salary ---
  // LinkedIn shows salary in job insight badges or compensation section
  const salarySelectors = [
    ".job-details-jobs-unified-top-card__job-insight-text-button",
    ".job-details-jobs-unified-top-card__job-insight span",
    '[class*="compensation"] span',
    '[class*="salary"]',
    ".compensation-and-other-insights span",
    ".job-insight__badge",
    '[class*="job-insight"] span',
  ]

  let salary = ""
  for (const sel of salarySelectors) {
    const els = document.querySelectorAll(sel)
    for (const el of els) {
      const text = el.textContent?.trim() || ""
      // Match patterns like $80,000, €60k, £50k/yr, $80K - $120K
      if (/[$€£][\d,kK]|[\d,]+\s*(k|K)?\s*(\/yr|\/year|per year|annually)/i.test(text)) {
        salary = text.replace(/\s+/g, " ").trim()
        break
      }
    }
    if (salary) break
  }

  // --- Recruiter Name ---
  // LinkedIn shows "Meet the hiring team" section on some job pages
  const recruiterName =
    document.querySelector(".jobs-poster__name")?.textContent?.trim() ||
    document.querySelector(".hirer-card__hirer-information .name")?.textContent?.trim() ||
    document.querySelector('[class*="hiring-team"] [class*="name"]')?.textContent?.trim() ||
    document.querySelector(".message-the-recruiter .name")?.textContent?.trim() ||
    document.querySelector('[data-test*="recruiter"] [class*="name"]')?.textContent?.trim() ||
    document.querySelector(".jobs-unified-top-card__job-insight--highlight span")?.textContent?.trim() ||
    ""

  return {
    jobTitle: jobTitle.replace(/\s+/g, " ").trim(),
    company: company.replace(/\s+/g, " ").trim(),
    location: cleanLocation,
    source: "LinkedIn",
    salary: salary,
    recruiterName: recruiterName.replace(/\s+/g, " ").trim(),
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getJobData") {
    let attempts = 0
    const maxAttempts = 5

    const tryGetData = () => {
      const data = getJobData()
      attempts++

      const hasData = data.jobTitle || data.company || data.location

      if (hasData || attempts >= maxAttempts) {
        sendResponse(data)
      } else {
        setTimeout(tryGetData, 500)
      }
    }

    tryGetData()
    return true
  }
})
