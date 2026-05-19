import { useEffect, useState } from "react"

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

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0].url || ""
      setCurrentUrl(url)
      setIsLinkedIn(url.includes("linkedin.com/jobs"))

      chrome.runtime.sendMessage({ action: "getSession" }, (res) => {
        setIsLoggedIn(!!res?.success)
      })

      if (url.includes("linkedin.com")) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "getJobData" }, (response) => {
          if (chrome.runtime.lastError) return
          if (response) {
            setJobData((prev) => ({
              ...prev,
              jobTitle: response.jobTitle || "",
              company: response.company || "",
              location: response.location || "",
              salary: response.salary || "",
              recruiterName: response.recruiterName || "",
            }))
          }
        })
      }
    })
  }, [])

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
        lastModifiedDate: today,
        notes: "",
        salary: jobData.salary || undefined,
        recruiterName: jobData.recruiterName || undefined,
        recruiterEmail: jobData.recruiterEmail || undefined,
      }

      const res = await fetch("https://api.job-tracker.in/api/v1/application", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setStatus("✅ Added to Job Tracker!")
      } else {
        const err = await res.text()
        setStatus(`❌ Failed: ${err}`)
      }
    } catch (err: any) {
      setStatus(`❌ Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const isSuccess = status.includes("✅")

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
      {isLoggedIn === true && (
        <div style={bannerStyle("#d1fae5", "#065f46")}>✅ Logged in to job-tracker.in</div>
      )}
      {!isLinkedIn && (
        <div style={bannerStyle("#fef3c7", "#92400e")}>
          ℹ️ Navigate to a LinkedIn job listing for auto-fill.
        </div>
      )}

      {/* Section: Job Details */}
      <p style={sectionLabel}>Job Details</p>
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

      {/* Section: Compensation */}
      <p style={sectionLabel}>
        Compensation{" "}
        <span style={{ color: "#9ca3af", fontWeight: "normal" }}>
          {jobData.salary ? "✓ auto-filled" : "enter manually if shown in JD"}
        </span>
      </p>
      <input style={inputStyle} placeholder="Salary / Range (e.g. $80k–$120k/yr)"
        value={jobData.salary}
        onChange={(e) => setJobData({ ...jobData, salary: e.target.value })} />

      {/* Section: Recruiter */}
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

      <button
        onClick={handleAddToTracker}
        disabled={loading}
        style={{
          ...buttonStyle,
          backgroundColor: loading ? "#93c5fd" : "#2563eb",
          cursor: loading ? "not-allowed" : "pointer"
        }}>
        {loading ? "⏳ Saving..." : "➕ Add to Job Tracker"}
      </button>

      {status && (
        <p style={{ marginTop: 10, fontSize: 13, color: isSuccess ? "green" : "red" }}>
          {status}
        </p>
      )}
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
  lineHeight: "1.5"
})

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  marginBottom: "8px",
  borderRadius: "6px",
  border: "1px solid #ccc",
  fontSize: "13px",
  boxSizing: "border-box"
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