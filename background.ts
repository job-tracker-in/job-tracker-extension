chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({
    url: "https://job-tracker.in",
    active: true // Open visibly so user knows to log in
  })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.create({
    url: "https://job-tracker.in",
    active: false // Refresh token silently on browser startup
  })
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSession") {
    chrome.storage.local.get("jt_token", (result) => {
      if (result.jt_token) {
        sendResponse({ success: true, accessToken: result.jt_token })
      } else {
        sendResponse({ success: false, error: "No token found" })
      }
    })
    return true // Keep message channel open for async response
  }
})
