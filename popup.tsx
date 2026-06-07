import { useEffect, useState } from "react"

type PopupState = "form" | "generating" | "cover-letter" | "error"

export default function Popup() {
  const [jobData, setJobData] = useState({
    jobTitle: "",
    company: "",
    location: "",
    source: "LinkedIn",
    salary: "",
    recruiterName: "",
    recruiterEmail: "",
  })
  const [status, setStatus] = useState("")
  const [currentUrl, setCurrentUrl] = useState("")
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [isLinkedIn, setIsLinkedIn] = useState(false)
  const [loading, setLoading] = useState(false)
  const [popupState, setPopupState] = useState<PopupState>("form")
  const [coverLetter, setCoverLetter] = useState("")
  const [copied, setCopied] = useState(false)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const [wantCoverLetter, setWantCoverLetter] = useState(true)
  const [jdSummary, setJdSummary] = useState<string[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const url = tab.url || ""
      setCurrentUrl(url)
      const onJobPage = url.includes("linkedin.com/jobs") ||
                        (url.includes("linkedin.com") && url.includes("currentJobId"))
      setIsLinkedIn(onJobPage)
      setActiveTabId(tab.id ?? null)

      chrome.runtime.sendMessage({ action: "getSession" }, (res) => {
        setIsLoggedIn(!!res?.success)
      })

      if (url.includes("linkedin.com")) {
        scrapeJobData(tab.id!)
      }
    })
  }, [])

  const scrapeJobData = (tabId: number) => {
    chrome.tabs.sendMessage(tabId, { action: "getJobData" }, (response) => {
      if (chrome.runtime.lastError || !response) return
      setJobData((prev) => ({
        ...prev,
        jobTitle: response.jobTitle || "",
        company: response.company || "",
        location: response.location || "",
        salary: response.salary || "",
        recruiterName: response.recruiterName || "",
      }))
    })
  }

  const getJobDescription = (): Promise<string> => {
    return new Promise((resolve) => {
      if (!activeTabId || !isLinkedIn) return resolve("")
      chrome.tabs.sendMessage(activeTabId, { action: "getJobDescription" }, (response) => {
        if (chrome.runtime.lastError || !response) return resolve("")
        resolve(response.jobDescription || "")
      })
    })
  }

  const generateCoverLetter = async (appId: string, token: string) => {
    setPopupState("generating")
    try {
      const jobDescription = await getJobDescription()

      const res = await fetch(
        `https://api.job-tracker.in/api/v1/application/${appId}/cover-letter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ jobDescription }),
        }
      )

      if (!res.ok) throw new Error(`Cover letter failed: ${res.status}`)

      const data = await res.json()
      setCoverLetter(data.coverLetter)
      setPopupState("cover-letter")
    } catch (err: any) {
      setStatus(`❌ Cover letter failed: ${err.message}`)
      setPopupState("error")
    }
  }

  const handleAddToTracker = async () => {
    setLoading(true)
    setStatus("Checking login...")

    try {
      const sessionResult = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ action: "getSession" }, resolve)
      })

      if (!sessionResult?.success || !sessionResult?.accessToken) {
        setStatus("⚠️ Not logged in — click the login link above, then try again.")
        setIsLoggedIn(false)
        setLoading(false)
        return
      }

      setStatus("Saving...")
      const token = sessionResult.accessToken
      const today = new Date().toISOString().split("T")[0]

      const payload = {
        company: jobData.company,
        location: jobData.location,
        jobTitle: jobData.jobTitle,
        source: "linkedIn",
        jobUrl: currentUrl,
        status: "APPLIED",
        appliedDate: today,
        notes: "",
        salary: jobData.salary || undefined,
        recruiterName: jobData.recruiterName || undefined,
        recruiterEmail: jobData.recruiterEmail || undefined,
      }

      const res = await fetch("https://api.job-tracker.in/api/v1/application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.text()
        setStatus(`❌ Failed: ${err}`)
        setLoading(false)
        return
      }

      // Extract application ID from Location header
      const location = res.headers.get("Location")
      const appId = location?.split("/").pop() ?? null
      setApplicationId(appId)
      setStatus("✅ Added to Job Tracker!")
      setLoading(false)

      // Auto-generate cover letter only if checkbox is checked
      if (wantCoverLetter && appId) {
        await generateCoverLetter(appId, token)
      } else {
        setPopupState("form")
      }
    } catch (err: any) {
      setStatus(`❌ Error: ${err.message}`)
      setLoading(false)
    }
  }

  const handleSummarise = async () => {
    setSummaryLoading(true)
    setJdSummary([])
    try {
      const sessionResult = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ action: "getSession" }, resolve)
      })
      if (!sessionResult?.accessToken) {
        setSummaryLoading(false)
        return
      }
      const jobDescription = await getJobDescription()
      if (!jobDescription) {
        setJdSummary(["No job description found on this page."])
        setSummaryLoading(false)
        return
      }
      const res = await fetch("https://api.job-tracker.in/api/v1/jd/summarise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionResult.accessToken}`,
        },
        body: JSON.stringify({ jobDescription }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setJdSummary(data.bullets || [])
    } catch (err: any) {
      setJdSummary([`Failed to summarise: ${err.message}`])
    } finally {
      setSummaryLoading(false)
    }
  }

  const handleRegenerate = async () => {
    const sessionResult = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ action: "getSession" }, resolve)
    })
    if (!sessionResult?.accessToken || !applicationId) return
    await generateCoverLetter(applicationId, sessionResult.accessToken)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(coverLetter).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Cover Letter View ─────────────────────────────────────────
  if (popupState === "cover-letter") {
    return (
      <div style={{ width: 380, padding: 16, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: "bold", margin: 0 }}>📄 Cover Letter</h2>
          <button
            onClick={() => setPopupState("form")}
            style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
          >
            ← Back
          </button>
        </div>

        <div style={bannerStyle("#d1fae5", "#065f46")}>✅ Added to Job Tracker!</div>

        <textarea
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          style={{
            width: "100%",
            height: 280,
            padding: "10px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            fontSize: "12px",
            lineHeight: "1.6",
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "sans-serif",
            color: "#111827",
          }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={handleCopy}
            style={{
              flex: 1,
              padding: "9px",
              backgroundColor: copied ? "#10b981" : "#2563eb",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {copied ? "✅ Copied!" : "📋 Copy"}
          </button>
          <button
            onClick={handleRegenerate}
            style={{
              flex: 1,
              padding: "9px",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            🔄 Regenerate
          </button>
        </div>
      </div>
    )
  }

  // ── Generating View ───────────────────────────────────────────
  if (popupState === "generating") {
    return (
      <div style={{ width: 380, padding: 16, fontFamily: "sans-serif" }}>
        <div style={bannerStyle("#d1fae5", "#065f46")}>✅ Added to Job Tracker!</div>
        <div style={{ textAlign: "center", padding: "32px 16px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
          <p style={{ fontSize: 14, color: "#374151", fontWeight: "bold" }}>Generating cover letter...</p>
          <p style={{ fontSize: 12, color: "#9ca3af" }}>Powered by Groq AI</p>
        </div>
      </div>
    )
  }

  // ── Main Form View ────────────────────────────────────────────
  return (
    <div style={{ width: 340, padding: 16, fontFamily: "sans-serif" }}>
      <h2 style={{ fontSize: 16, fontWeight: "bold", marginBottom: 12 }}>
        🧳 Job Tracker Extension
      </h2>

      {isLoggedIn === null && (
        <div style={bannerStyle("#f3f4f6", "#6b7280")}>⏳ Checking login status...</div>
      )}
      {isLoggedIn === false && (
        <div style={bannerStyle("#fef3c7", "#92400e")}>
          ⚠️ You're not logged in.{" "}
          <a href="https://job-tracker.in" target="_blank" rel="noreferrer"
            style={{ color: "#92400e", fontWeight: "bold" }}>
            Log in to job-tracker.in
          </a>{" "}
          first, then come back here.
        </div>
      )}
      {isLoggedIn === true && popupState !== "error" && !status && (
        <div style={bannerStyle("#d1fae5", "#065f46")}>✅ Logged in to job-tracker.in</div>
      )}
      {status && popupState !== "cover-letter" && (
        <div style={bannerStyle(
          status.includes("✅") ? "#d1fae5" : "#fef3c7",
          status.includes("✅") ? "#065f46" : "#92400e"
        )}>
          {status}
        </div>
      )}
      {!isLinkedIn && (
        <div style={bannerStyle("#fef3c7", "#92400e")}>
          ℹ️ Navigate to a LinkedIn job listing for auto-fill.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 6 }}>
        <p style={{ ...sectionLabel, margin: 0 }}>Job Details</p>
        {isLinkedIn && (
          <button
            onClick={handleSummarise}
            disabled={summaryLoading}
            style={{
              fontSize: 11,
              padding: "3px 8px",
              backgroundColor: summaryLoading ? "#e9d5ff" : "#f3e8ff",
              color: "#7c3aed",
              border: "1px solid #d8b4fe",
              borderRadius: 5,
              cursor: summaryLoading ? "not-allowed" : "pointer",
              fontWeight: "bold",
              whiteSpace: "nowrap",
            }}
          >
            {summaryLoading ? "⏳ Summarising..." : "✨ Summarise JD"}
          </button>
        )}
      </div>

      {jdSummary.length > 0 && (
        <div style={{
          background: "#f5f3ff",
          border: "1px solid #ddd6fe",
          borderRadius: 6,
          padding: "8px 10px",
          marginBottom: 8,
        }}>
          {jdSummary.map((bullet, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: i < jdSummary.length - 1 ? 5 : 0 }}>
              <span style={{ color: "#7c3aed", fontWeight: "bold", flexShrink: 0 }}>•</span>
              <span style={{ fontSize: 11, color: "#374151", lineHeight: "1.5" }}>{bullet}</span>
            </div>
          ))}
        </div>
      )}

      <input style={inputStyle} placeholder="Job Title"
        value={jobData.jobTitle}
        onChange={(e) => setJobData({ ...jobData, jobTitle: e.target.value })} />
      <input style={inputStyle} placeholder="Company"
        value={jobData.company}
        onChange={(e) => setJobData({ ...jobData, company: e.target.value })} />
      <input style={inputStyle} placeholder="Location"
        value={jobData.location}
        onChange={(e) => setJobData({ ...jobData, location: e.target.value })} />
      <input style={inputStyle} placeholder="Source (LinkedIn, Indeed...)"
        value={jobData.source}
        onChange={(e) => setJobData({ ...jobData, source: e.target.value })} />

      <p style={sectionLabel}>
        Compensation{" "}
        <span style={{ color: "#9ca3af", fontWeight: "normal" }}>
          {jobData.salary ? "✓ auto-filled" : "enter manually if shown"}
        </span>
      </p>
      <input style={inputStyle} placeholder="Salary / Range (e.g. $80k–$120k/yr)"
        value={jobData.salary}
        onChange={(e) => setJobData({ ...jobData, salary: e.target.value })} />

      <p style={sectionLabel}>
        Recruiter{" "}
        <span style={{ color: "#9ca3af", fontWeight: "normal" }}>
          {jobData.recruiterName ? "✓ name auto-filled" : "enter manually if known"}
        </span>
      </p>
      <input style={inputStyle} placeholder="Recruiter Name"
        value={jobData.recruiterName}
        onChange={(e) => setJobData({ ...jobData, recruiterName: e.target.value })} />
      <input style={inputStyle} placeholder="Recruiter Email (manual)"
        value={jobData.recruiterEmail}
        onChange={(e) => setJobData({ ...jobData, recruiterEmail: e.target.value })} />

      <label style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        marginBottom: 4,
        fontSize: 13,
        color: "#374151",
        cursor: "pointer",
      }}>
        <input
          type="checkbox"
          checked={wantCoverLetter}
          onChange={(e) => setWantCoverLetter(e.target.checked)}
          style={{ width: 15, height: 15, cursor: "pointer" }}
        />
        Generate cover letter after saving
      </label>

      <button
        onClick={handleAddToTracker}
        disabled={loading}
        style={{
          ...buttonStyle,
          backgroundColor: loading ? "#93c5fd" : "#2563eb",
          cursor: loading ? "not-allowed" : "pointer",
        }}>
        {loading ? "⏳ Saving..." : "➕ Add to Job Tracker"}
      </button>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: "bold",
  color: "#374151",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
  marginTop: 10,
}

const bannerStyle = (bg: string, color: string): React.CSSProperties => ({
  background: bg,
  color,
  padding: "8px 10px",
  borderRadius: 6,
  marginBottom: 10,
  fontSize: 12,
  lineHeight: "1.5",
})

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  marginBottom: "8px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  fontSize: "13px",
  boxSizing: "border-box",
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px",
  backgroundColor: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  marginTop: 4,
}
