export const config = {
  matches: ["https://job-tracker.in/*"]
}

async function saveToken() {
  try {
    const res = await fetch("/api/auth/session")

    if (!res.ok) {
      console.warn("⚠️ Session endpoint returned:", res.status)
      return
    }

    const session = await res.json()

    if (session?.accessToken) {
      await chrome.storage.local.set({ jt_token: session.accessToken })
      console.log("✅ Token saved successfully!")
    } else {
      // User is on the site but not logged in — clear any stale token
      await chrome.storage.local.remove("jt_token")
      console.log("ℹ️ No token in session — user may not be logged in yet.")
    }
  } catch (e) {
    console.error("❌ Could not save token:", e)
  }
}

// Save token immediately when page loads
saveToken()

// Refresh token every 1 minute to keep it fresh
setInterval(saveToken, 60 * 1000)

// Also save token whenever the page becomes visible again (e.g. user switches tabs back)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    saveToken()
  }
})
