// Content script: scrapes Amazon orders via hidden iframes
// Amazon encrypts order data client-side, so we must use rendered DOM.
// Supports amazon.de and amazon.in

var AMAZON_BASE = "https://" + window.location.hostname;
var AMAZON_DOMAIN = window.location.hostname;
var STORAGE_KEY = "orderData_" + AMAZON_DOMAIN;

injectFAB();

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "scrapeOrders") {
    scrapeAllOrders().then(sendResponse).catch(function(err) {
      console.error("Scrape error:", err);
      sendResponse({ orders: [], error: err.message });
    });
    return true;
  }
  if (request.action === "toggleFAB") {
    var fab = document.getElementById("amz-analytics-fab");
    if (fab) fab.style.display = fab.style.display === "none" ? "flex" : "none";
    sendResponse({ ok: true });
    return true;
  }
});

// ---- Floating Action Button ----
function injectFAB() {
  if (document.getElementById("amz-analytics-fab")) return;

  var fab = document.createElement("div");
  fab.id = "amz-analytics-fab";
  fab.innerHTML = '<div id="amz-fab-btn" title="Amazon Analytics">' +
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">' +
    '<rect x="3" y="12" width="4" height="9" rx="1"/>' +
    '<rect x="10" y="7" width="4" height="14" rx="1"/>' +
    '<rect x="17" y="3" width="4" height="18" rx="1"/>' +
    '</svg></div>' +
    '<div id="amz-fab-tooltip">Analyze My Orders</div>';

  var style = document.createElement("style");
  style.textContent = [
    "#amz-analytics-fab {",
    "  position: fixed; bottom: 28px; right: 28px; z-index: 999999;",
    "  display: flex; align-items: center; gap: 10px; flex-direction: row-reverse;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "}",
    "#amz-fab-btn {",
    "  width: 52px; height: 52px; border-radius: 16px;",
    "  background: linear-gradient(135deg, #ff9900, #e68a00);",
    "  display: flex; align-items: center; justify-content: center;",
    "  cursor: pointer;",
    "  box-shadow: 0 4px 20px rgba(255,153,0,0.4), 0 2px 8px rgba(0,0,0,0.2);",
    "  transition: transform 0.2s, box-shadow 0.2s;",
    "  position: relative;",
    "}",
    "#amz-fab-btn:hover {",
    "  transform: scale(1.08);",
    "  box-shadow: 0 6px 28px rgba(255,153,0,0.5), 0 4px 12px rgba(0,0,0,0.3);",
    "}",
    "#amz-fab-btn:active { transform: scale(0.95); }",
    "#amz-fab-tooltip {",
    "  background: #232f3e; color: #fff; padding: 8px 14px; border-radius: 8px;",
    "  font-size: 13px; font-weight: 500; white-space: nowrap;",
    "  box-shadow: 0 4px 12px rgba(0,0,0,0.3);",
    "  opacity: 0; transform: translateX(8px);",
    "  transition: opacity 0.2s, transform 0.2s; pointer-events: none;",
    "}",
    "#amz-analytics-fab:hover #amz-fab-tooltip { opacity: 1; transform: translateX(0); }",
    "#amz-fab-progress {",
    "  position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);",
    "  background: #232f3e; color: #ff9900; font-size: 10px; font-weight: 600;",
    "  padding: 2px 8px; border-radius: 10px; white-space: nowrap;",
    "  box-shadow: 0 2px 8px rgba(0,0,0,0.3);",
    "}",
    "@keyframes amz-fab-spin { to { transform: rotate(360deg); } }",
    "#amz-fab-btn.loading svg { animation: amz-fab-spin 1.5s linear infinite; }"
  ].join("\n");

  document.head.appendChild(style);
  document.body.appendChild(fab);

  document.getElementById("amz-fab-btn").addEventListener("click", handleFABClick);
}

async function handleFABClick() {
  var btn = document.getElementById("amz-fab-btn");
  var tooltip = document.getElementById("amz-fab-tooltip");

  // Check for cached data for THIS domain
  var cached = await new Promise(function(resolve) {
    chrome.storage.local.get(STORAGE_KEY, function(r) { resolve(r[STORAGE_KEY] || null); });
  });

  if (cached && cached.orders && cached.orders.length > 0) {
    var age = Date.now() - (cached.timestamp || 0);
    if (age < 3600000) {
      chrome.runtime.sendMessage({ action: "openDashboard", domain: AMAZON_DOMAIN });
      return;
    }
  }

  // Start scraping with visual feedback
  btn.classList.add("loading");
  tooltip.textContent = "Scanning orders...";
  tooltip.style.opacity = "1";
  tooltip.style.transform = "translateX(0)";

  var progressEl = document.getElementById("amz-fab-progress");
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.id = "amz-fab-progress";
    btn.appendChild(progressEl);
  }
  progressEl.textContent = "0 orders";

  var progressListener = function(msg) {
    if (msg.action === "progress") {
      progressEl.textContent = msg.count + " orders";
      tooltip.textContent = "Scanning " + msg.year + "...";
    }
  };
  chrome.runtime.onMessage.addListener(progressListener);

  try {
    var result = await scrapeAllOrders();

    if (result.orders && result.orders.length > 0) {
      var data = { orders: result.orders, timestamp: Date.now(), currency: result.currency, domain: result.domain };
      var toStore = {};
      toStore[STORAGE_KEY] = data;
      chrome.storage.local.set(toStore);
      chrome.runtime.sendMessage({ action: "openDashboard", domain: AMAZON_DOMAIN });
    } else {
      tooltip.textContent = "No orders found";
      setTimeout(function() {
        tooltip.textContent = "Analyze My Orders";
        tooltip.style.opacity = "";
        tooltip.style.transform = "";
      }, 3000);
    }
  } catch (err) {
    console.error("Scrape error:", err);
    tooltip.textContent = "Error - try again";
    setTimeout(function() {
      tooltip.textContent = "Analyze My Orders";
      tooltip.style.opacity = "";
      tooltip.style.transform = "";
    }, 3000);
  }

  btn.classList.remove("loading");
  if (progressEl) progressEl.remove();
  chrome.runtime.onMessage.removeListener(progressListener);
}

// ---- Scraping ----
async function scrapeAllOrders() {
  var allOrders = [];
  var years = await getAvailableYears();

  for (var i = 0; i < years.length; i++) {
    var year = years[i];
    var startIndex = 0;
    var hasMore = true;

    while (hasMore) {
      var url = "" + AMAZON_BASE + "/your-orders/orders?timeFilter=year-" + year +
        "&ref_=ppx_yo2ov_dt_b_filter_all_y" + year + "&startIndex=" + startIndex;
      var pageOrders = await scrapeViaIframe(url);

      if (pageOrders.length === 0) {
        hasMore = false;
      } else {
        allOrders.push.apply(allOrders, pageOrders);
        startIndex += 10;
      }

      chrome.runtime.sendMessage({
        action: "progress",
        year: year,
        count: allOrders.length,
      });
    }
  }

  var currency = AMAZON_DOMAIN.indexOf("amazon.in") >= 0 ? "INR" : AMAZON_DOMAIN.indexOf("amazon.com") >= 0 ? "USD" : "EUR";
  return { orders: allOrders, domain: AMAZON_DOMAIN, currency: currency };
}

async function getAvailableYears() {
  var years = extractYearsFromDoc(document);

  if (years.length === 0) {
    years = await new Promise(function(resolve) {
      var iframe = createHiddenIframe();
      var timeout = setTimeout(function() { removeIframe(iframe); resolve([]); }, 15000);

      iframe.onload = function() {
        waitForRendered(iframe, function() {
          clearTimeout(timeout);
          try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            var found = extractYearsFromDoc(doc);
            removeIframe(iframe);
            resolve(found);
          } catch (e) {
            removeIframe(iframe);
            resolve([]);
          }
        });
      };

      iframe.src = "" + AMAZON_BASE + "/your-orders/orders";
    });
  }

  if (years.length === 0) {
    var currentYear = new Date().getFullYear();
    for (var y = currentYear; y >= currentYear - 4; y--) years.push(y);
  }

  return years.sort(function(a, b) { return b - a; });
}

function extractYearsFromDoc(doc) {
  var years = [];
  var seen = {};
  var html = doc.documentElement.innerHTML || "";
  var re = /year-(\d{4})/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var y = parseInt(m[1]);
    if (!seen[y] && y >= 2000 && y <= 2030) {
      seen[y] = true;
      years.push(y);
    }
  }
  return years;
}

function scrapeViaIframe(url) {
  return new Promise(function(resolve) {
    var iframe = createHiddenIframe();
    var timeout = setTimeout(function() { removeIframe(iframe); resolve([]); }, 20000);

    iframe.onload = function() {
      waitForOrderContent(iframe, function(orders) {
        clearTimeout(timeout);
        removeIframe(iframe);
        resolve(orders);
      });
    };

    iframe.onerror = function() {
      clearTimeout(timeout);
      removeIframe(iframe);
      resolve([]);
    };

    iframe.src = url;
  });
}

function createHiddenIframe() {
  var iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:-10000px;left:-10000px;width:1024px;height:768px;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);
  return iframe;
}

function removeIframe(iframe) {
  try { iframe.parentNode.removeChild(iframe); } catch (e) {}
}

function waitForRendered(iframe, callback, attempts) {
  attempts = attempts || 0;
  if (attempts > 30) { callback(); return; }
  setTimeout(function() {
    try {
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      if (doc.readyState === "complete") { callback(); return; }
    } catch (e) {}
    waitForRendered(iframe, callback, attempts + 1);
  }, 500);
}

function waitForOrderContent(iframe, callback, attempts) {
  attempts = attempts || 0;
  if (attempts > 30) { callback([]); return; }

  setTimeout(function() {
    try {
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      var cards = doc.querySelectorAll(".order-card");

      if (cards.length === 0 && attempts > 10) {
        callback([]);
        return;
      }

      if (cards.length > 0) {
        var text = cards[0].innerText || "";
        if (text.length > 20 && (text.indexOf("€") >= 0 || text.indexOf("EUR") >= 0 || text.indexOf("₹") >= 0 || text.indexOf("INR") >= 0 || text.indexOf("$") >= 0 || text.indexOf("USD") >= 0 || text.indexOf("ORDER") >= 0 || text.indexOf("Bestell") >= 0)) {
          var orders = [];
          for (var i = 0; i < cards.length; i++) {
            var order = extractOrderData(cards[i]);
            if (order && order.total > 0) {
              orders.push(order);
            }
          }
          callback(orders);
          return;
        }
      }
    } catch (e) {
      console.warn("iframe access error:", e.message);
      callback([]);
      return;
    }

    waitForOrderContent(iframe, callback, attempts + 1);
  }, 500);
}

function extractOrderData(card) {
  var text = card.innerText || card.textContent || "";

  // --- Date ---
  var orderDate = null;

  var enMatch = text.match(
    /(\d{1,2})\.?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  if (enMatch) {
    orderDate = parseDate(enMatch[1], enMatch[2], enMatch[3]);
  }

  if (!orderDate) {
    var deMatch = text.match(
      /(\d{1,2})\.?\s+(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/i
    );
    if (deMatch) {
      orderDate = parseDate(deMatch[1], deMatch[2], deMatch[3]);
    }
  }

  if (!orderDate) {
    var numMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (numMatch) {
      orderDate = new Date(parseInt(numMatch[3]), parseInt(numMatch[2]) - 1, parseInt(numMatch[1])).toISOString();
    }
  }

  // --- Price ---
  var total = 0;

  var euroPrefixMatch = text.match(/€\s*([\d,]+\.\d{2})/);
  if (euroPrefixMatch) {
    total = parseFloat(euroPrefixMatch[1].replace(/,/g, ""));
  }

  if (total === 0) {
    var eurMatch = text.match(/EUR\s*([\d.]+,\d{2})/);
    if (eurMatch) {
      total = parseFloat(eurMatch[1].replace(/\./g, "").replace(",", "."));
    }
  }

  if (total === 0) {
    var suffixMatch = text.match(/([\d.]+,\d{2})\s*€/);
    if (suffixMatch) {
      total = parseFloat(suffixMatch[1].replace(/\./g, "").replace(",", "."));
    }
  }

  // ₹1,059.00 or INR 1,059.00 (Indian format)
  if (total === 0) {
    var inrPrefixMatch = text.match(/₹\s*([\d,]+\.?\d*)/);
    if (inrPrefixMatch) {
      total = parseFloat(inrPrefixMatch[1].replace(/,/g, ""));
    }
  }

  if (total === 0) {
    var inrMatch = text.match(/INR\s*([\d,]+\.?\d*)/);
    if (inrMatch) {
      total = parseFloat(inrMatch[1].replace(/,/g, ""));
    }
  }

  // $59.89 or $1,059.89 (USD)
  if (total === 0) {
    var usdMatch = text.match(/\$\s*([\d,]+\.\d{2})/);
    if (usdMatch) {
      total = parseFloat(usdMatch[1].replace(/,/g, ""));
    }
  }

  if (total === 0) {
    var usdMatch2 = text.match(/USD\s*([\d,]+\.?\d*)/);
    if (usdMatch2) {
      total = parseFloat(usdMatch2[1].replace(/,/g, ""));
    }
  }

  // --- Order number ---
  var orderNumMatch = text.match(/ORDER\s*#\s*([\d-]+)|Bestellnummer[:\s]*([\d-]+)|(\d{3}-\d{7}-\d{7})/i);
  var orderNumber = orderNumMatch ? (orderNumMatch[1] || orderNumMatch[2] || orderNumMatch[3]) : null;

  // --- Items ---
  var items = [];
  var links = card.querySelectorAll('a[href*="/gp/product/"], a[href*="/dp/"]');
  for (var i = 0; i < links.length; i++) {
    var name = links[i].textContent.trim();
    if (name && name.length > 3 && name.length < 300 && !name.match(/^(Return|Buy|View|Track|Write|Share|Get)/)) {
      items.push(name);
    }
  }

  if (items.length === 0) {
    var lines = text.split("\n");
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (line.length > 10 && line.length < 300 &&
        !line.match(/^(ORDER|TOTAL|DISPATCH|Delivered|Arriving|Return|Buy it|View|Track|Write|Share|Get |Eligible|Invoice|Parcel|Refund|\d)/i) &&
        !line.match(/ORDER\s*#/i) &&
        !line.match(/[€₹$]/) &&
        !line.match(/^\d+\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i)
      ) {
        items.push(line);
        break;
      }
    }
  }

  var category = guessCategory(items.join(" ") + " " + text);
  var year = orderDate ? new Date(orderDate).getFullYear() : new Date().getFullYear();
  var month = orderDate ? new Date(orderDate).getMonth() : 0;

  return { date: orderDate, total: total, orderNumber: orderNumber, items: items, category: category, year: year, month: month };
}

var MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  januar: 0, februar: 1, "märz": 2, mai: 4, juni: 5,
  juli: 6, oktober: 9, dezember: 11
};

function parseDate(day, monthName, year) {
  var month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return null;
  return new Date(parseInt(year), month, parseInt(day)).toISOString();
}

function guessCategory(text) {
  var t = text.toLowerCase();
  var categories = {
    Electronics: [
      "kabel", "usb", "hdmi", "adapter", "ladegerät", "charger", "akku",
      "batterie", "kopfhörer", "headphone", "lautsprecher", "speaker",
      "monitor", "tastatur", "keyboard", "maus", "mouse", "festplatte",
      "ssd", "ram", "computer", "laptop", "tablet", "phone", "handy",
      "smartphone", "kindle", "echo", "alexa", "fire tv", "hub", "dongle",
      "cable", "wireless", "bluetooth", "wifi", "router", "camera",
      "printer", "scanner", "projector", "microphone", "webcam",
      "cordless", "battery", "power", "volt"
    ],
    "Books & Media": [
      "buch", "book", "taschenbuch", "hardcover", "paperback", "roman",
      "dvd", "blu-ray", "cd", "vinyl", "hörbuch", "audiobook", "novel",
      "edition", "volume", "guide", "handbook"
    ],
    "Clothing & Shoes": [
      "shirt", "hose", "jacke", "mantel", "schuh", "sneaker", "socke",
      "kleid", "pullover", "hoodie", "jeans", "unterwäsche", "gürtel",
      "dress", "pants", "jacket", "coat", "shoe", "boot", "sandal",
      "belt", "hat", "cap", "gloves", "scarf"
    ],
    "Home & Garden": [
      "lampe", "glühbirne", "möbel", "regal", "tisch", "stuhl",
      "kissen", "decke", "vorhang", "garten", "pflanze",
      "werkzeug", "schrauben", "bohrer", "dübel", "drill", "screwdriver",
      "hammer", "wrench", "saw", "pliers", "tool", "garden",
      "lamp", "shelf", "table", "chair", "curtain", "furniture", "bosch"
    ],
    "Kitchen & Home": [
      "küche", "kochen", "pfanne", "messer", "besteck",
      "tasse", "glas", "teller", "geschirr", "reinig", "putz",
      "waschmittel", "spülmittel", "müllbeutel", "staubsauger",
      "kitchen", "cook", "pan", "pot", "knife", "cutlery", "plate",
      "cup", "mug", "bowl", "cleaning", "vacuum", "dishwasher"
    ],
    "Food & Drinks": [
      "kaffee", "tee", "schokolade", "snack", "nüsse", "protein",
      "nahrung", "gewürz", "öl", "bio", "vegan",
      "coffee", "tea", "chocolate", "food", "drink", "organic"
    ],
    "Sports & Outdoors": [
      "fitness", "sport", "yoga", "hantel", "training", "fahrrad",
      "camping", "wandern", "rucksack", "outdoor", "bicycle", "bike",
      "gym", "exercise", "running", "hiking", "backpack"
    ],
    "Health & Beauty": [
      "shampoo", "seife", "creme", "zahnbürste", "zahnpasta",
      "pflaster", "medizin", "vitamin", "nahrungsergänzung",
      "soap", "cream", "toothbrush", "toothpaste", "skincare",
      "moisturizer", "sunscreen", "hair", "body wash"
    ],
    "Baby & Kids": [
      "baby", "kind", "spielzeug", "windel", "schnuller", "lego",
      "puppe", "puzzle", "toy", "diaper", "stroller", "pacifier"
    ]
  };

  var catNames = Object.keys(categories);
  for (var i = 0; i < catNames.length; i++) {
    var keywords = categories[catNames[i]];
    for (var j = 0; j < keywords.length; j++) {
      if (t.indexOf(keywords[j]) >= 0) {
        return catNames[i];
      }
    }
  }
  return "Other";
}
