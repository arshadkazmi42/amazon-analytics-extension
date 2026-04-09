// Background service worker

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && (tab.url.includes("amazon.de") || tab.url.includes("amazon.in") || tab.url.includes("amazon.com"))) {
    chrome.tabs.sendMessage(tab.id, { action: "toggleFAB" });
  } else {
    // Open Amazon orders page
    chrome.tabs.create({ url: "https://www.amazon.de/your-orders/orders" });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "openDashboard") {
    var domain = msg.domain || "www.amazon.de";
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html") + "?domain=" + encodeURIComponent(domain),
    });
  }
});
