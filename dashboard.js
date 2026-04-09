// dashboard.js — Full-page dashboard for Amazon Analytics

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CHART_COLORS = [
  "#4e8cff", "#a855f7", "#22c55e", "#ff9900", "#ef4444",
  "#ec4899", "#06b6d4", "#f59e0b", "#8b5cf6", "#10b981",
  "#f43f5e", "#6366f1",
];

let allOrders = [];
let charts = {};
let currency = "EUR";
let amazonDomain = "www.amazon.de";

// ---- Init ----
document.addEventListener("DOMContentLoaded", async () => {
  // Get domain from URL param
  const params = new URLSearchParams(window.location.search);
  amazonDomain = params.get("domain") || "www.amazon.de";
  const storageKey = "orderData_" + amazonDomain;

  const data = await new Promise((resolve) => {
    chrome.storage.local.get(storageKey, (r) => resolve(r[storageKey] || null));
  });

  if (data && data.orders && data.orders.length > 0) {
    allOrders = data.orders;
    currency = data.currency || "EUR";
    amazonDomain = data.domain || amazonDomain;
    showDashboard();
  } else {
    showError("Please go to Amazon, log in, and click the analytics button to scan your orders first.");
  }
});

document.getElementById("refresh-btn").addEventListener("click", async () => {
  var storageKey = "orderData_" + amazonDomain;
  chrome.storage.local.remove(storageKey);
  showScreen("loading-screen");
  document.getElementById("loading-status").textContent = "Connecting to Amazon...";
  var bar = document.getElementById("dash-progress-fill");
  var detail = document.getElementById("loading-detail");
  if (bar) bar.style.width = "5%";
  if (detail) detail.textContent = "";

  // Listen for progress from content script
  var progressListener = function(msg) {
    if (msg.action === "progress") {
      if (bar) bar.style.width = Math.min(90, 10 + msg.count * 2) + "%";
      document.getElementById("loading-status").textContent = "Scanning " + msg.year + "...";
      if (detail) detail.textContent = msg.count + " orders found so far";
    }
  };
  chrome.runtime.onMessage.addListener(progressListener);

  // Find a tab for the current domain
  var tabs = await chrome.tabs.query({ url: "https://" + amazonDomain + "/*" });
  var orderUrl = "https://" + amazonDomain + "/your-orders/orders";
  if (tabs.length === 0) {
    document.getElementById("loading-status").textContent = "Opening Amazon...";
    const newTab = await chrome.tabs.create({ url: orderUrl, active: false });
    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === newTab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
    tabs.push(newTab);
  }

  try {
    document.getElementById("loading-status").textContent = "Scanning orders...";
    const response = await chrome.tabs.sendMessage(tabs[0].id, { action: "scrapeOrders" });
    chrome.runtime.onMessage.removeListener(progressListener);

    if (response && response.orders && response.orders.length > 0) {
      if (bar) bar.style.width = "100%";
      document.getElementById("loading-status").textContent = "Building dashboard...";
      if (detail) detail.textContent = response.orders.length + " orders analyzed";

      currency = response.currency || currency;
      amazonDomain = response.domain || amazonDomain;
      var data = { orders: response.orders, timestamp: Date.now(), currency: currency, domain: amazonDomain };
      var toStore = {};
      toStore["orderData_" + amazonDomain] = data;
      chrome.storage.local.set(toStore);
      allOrders = response.orders;
      setTimeout(function() { showDashboard(); }, 500);
    } else {
      showError("No orders found. Make sure you are logged in to Amazon.");
    }
  } catch (err) {
    chrome.runtime.onMessage.removeListener(progressListener);
    showError("Could not connect to Amazon. Please open Amazon in another tab and try again.");
  }
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  showScreen("error-screen");
}

// ---- Dashboard ----
function showDashboard() {
  showScreen("dashboard");
  var domainSuffix = amazonDomain.indexOf("amazon.in") >= 0 ? ".in" : amazonDomain.indexOf("amazon.com") >= 0 ? ".com" : ".de";
  document.querySelector("header h1").innerHTML = "Amazon<span class=\"accent\">" + domainSuffix + "</span> Analytics";
  document.getElementById("order-count-badge").textContent =
    allOrders.length + " orders analyzed";
  populateYearFilter();
  renderAll(allOrders);
}

function populateYearFilter() {
  const years = [...new Set(allOrders.map((o) => o.year))].sort(
    (a, b) => b - a
  );
  const container = document.querySelector(".year-filter");
  container.innerHTML =
    '<button class="year-btn active" data-year="all">All Years</button>';

  for (const year of years) {
    const btn = document.createElement("button");
    btn.className = "year-btn";
    btn.dataset.year = year;
    btn.textContent = year;
    container.appendChild(btn);
  }

  container.addEventListener("click", (e) => {
    if (!e.target.classList.contains("year-btn")) return;
    container
      .querySelectorAll(".year-btn")
      .forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");

    const year = e.target.dataset.year;
    const filtered =
      year === "all"
        ? allOrders
        : allOrders.filter((o) => o.year === parseInt(year));
    renderAll(filtered);
  });
}

function renderAll(orders) {
  renderSummary(orders);
  renderMonthlyChart(orders);
  renderCategoryChart(orders);
  renderYearlyChart(orders);
  renderTimelineChart(orders);
  renderInsights(orders);
  renderTopOrders(orders);
}

function formatEUR(amount) {
  var locale = currency === "INR" ? "en-IN" : currency === "USD" ? "en-US" : "de-DE";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency,
  }).format(amount);
}

// ---- Summary Cards ----
function renderSummary(orders) {
  const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);
  const avgOrder = orders.length > 0 ? totalSpent / orders.length : 0;
  const biggestOrder = orders.length > 0 ? Math.max(...orders.map((o) => o.total)) : 0;

  document.getElementById("total-spent").textContent = formatEUR(totalSpent);
  document.getElementById("total-orders").textContent = orders.length.toLocaleString("de-DE");
  document.getElementById("avg-order").textContent = formatEUR(avgOrder);
  document.getElementById("biggest-order").textContent = formatEUR(biggestOrder);
}

// ---- Monthly Spending Chart ----
function renderMonthlyChart(orders) {
  const monthlyData = new Array(12).fill(0);
  for (const order of orders) {
    monthlyData[order.month] += order.total;
  }

  if (charts.monthly) charts.monthly.destroy();
  const ctx = document.getElementById("monthlyChart").getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, "rgba(78, 140, 255, 0.3)");
  gradient.addColorStop(1, "rgba(78, 140, 255, 0.02)");

  charts.monthly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_NAMES,
      datasets: [
        {
          data: monthlyData,
          backgroundColor: gradient,
          borderColor: "#4e8cff",
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            label: (ctx) => formatEUR(ctx.parsed.y),
          },
        },
      },
    },
  });
}

// ---- Category Chart ----
function renderCategoryChart(orders) {
  const catMap = {};
  for (const order of orders) {
    const cat = order.category || "Sonstiges";
    catMap[cat] = (catMap[cat] || 0) + order.total;
  }

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const data = sorted.map(([, v]) => v);

  if (charts.category) charts.category.destroy();
  const ctx = document.getElementById("categoryChart").getContext("2d");

  charts.category = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: CHART_COLORS.slice(0, labels.length),
          borderColor: "transparent",
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#8b8fa3",
            font: { size: 10 },
            boxWidth: 10,
            padding: 6,
          },
        },
        tooltip: {
          backgroundColor: "#1a1d27",
          titleColor: "#e4e6ed",
          bodyColor: "#e4e6ed",
          borderColor: "#2a2e3d",
          borderWidth: 1,
          padding: 8,
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatEUR(ctx.parsed)}`,
          },
        },
      },
    },
  });
}

// ---- Yearly Chart ----
function renderYearlyChart(orders) {
  const yearMap = {};
  for (const order of orders) {
    yearMap[order.year] = (yearMap[order.year] || 0) + order.total;
  }

  const years = Object.keys(yearMap).sort();
  const data = years.map((y) => yearMap[y]);

  if (charts.yearly) charts.yearly.destroy();
  const ctx = document.getElementById("yearlyChart").getContext("2d");

  charts.yearly = new Chart(ctx, {
    type: "bar",
    data: {
      labels: years,
      datasets: [
        {
          data,
          backgroundColor: CHART_COLORS.slice(0, years.length),
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            label: (ctx) => formatEUR(ctx.parsed.y),
          },
        },
      },
    },
  });
}

// ---- Orders Timeline ----
function renderTimelineChart(orders) {
  // Group by year-month
  const timeMap = {};
  for (const order of orders) {
    const key = `${order.year}-${String(order.month + 1).padStart(2, "0")}`;
    if (!timeMap[key]) timeMap[key] = { total: 0, count: 0 };
    timeMap[key].total += order.total;
    timeMap[key].count++;
  }

  const sortedKeys = Object.keys(timeMap).sort();
  const labels = sortedKeys.map((k) => {
    const [y, m] = k.split("-");
    return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`;
  });

  if (charts.timeline) charts.timeline.destroy();
  const ctx = document.getElementById("ordersTimelineChart").getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, "rgba(168, 85, 247, 0.25)");
  gradient.addColorStop(1, "rgba(168, 85, 247, 0.02)");

  charts.timeline = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Spending",
          data: sortedKeys.map((k) => timeMap[k].total),
          borderColor: "#a855f7",
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: "#a855f7",
          borderWidth: 2,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        ...chartDefaults().scales,
        x: {
          ...chartDefaults().scales.x,
          ticks: {
            ...chartDefaults().scales.x.ticks,
            maxTicksLimit: 12,
          },
        },
      },
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            label: (ctx) => formatEUR(ctx.parsed.y),
          },
        },
      },
    },
  });
}

// ---- Insights ----
function renderInsights(orders) {
  const container = document.getElementById("insights-grid");
  const insights = [];

  if (orders.length === 0) {
    container.innerHTML = '<p style="color: var(--text-dim)">No data</p>';
    return;
  }

  // Most active month
  const monthCounts = new Array(12).fill(0);
  for (const o of orders) monthCounts[o.month]++;
  const peakMonth = monthCounts.indexOf(Math.max(...monthCounts));
  insights.push({
    icon: "📅",
    title: "Busiest Month",
    value: MONTH_NAMES[peakMonth],
    detail: `${monthCounts[peakMonth]} orders`,
  });

  // Average per month
  const months = new Set(orders.map((o) => `${o.year}-${o.month}`)).size;
  const avgPerMonth =
    months > 0 ? orders.reduce((s, o) => s + o.total, 0) / months : 0;
  insights.push({
    icon: "📊",
    title: "Avg / Month",
    value: formatEUR(avgPerMonth),
    detail: `across ${months} months`,
  });

  // Orders per month average
  const ordersPerMonth = months > 0 ? (orders.length / months).toFixed(1) : 0;
  insights.push({
    icon: "📦",
    title: "Orders / Month",
    value: ordersPerMonth,
    detail: "average frequency",
  });

  // Top category
  const catMap = {};
  for (const o of orders) catMap[o.category] = (catMap[o.category] || 0) + o.total;
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
  if (topCat) {
    insights.push({
      icon: "🏆",
      title: "Top Category",
      value: topCat[0],
      detail: formatEUR(topCat[1]),
    });
  }

  // Spending trend (first half vs second half)
  const half = Math.floor(orders.length / 2);
  if (half > 0) {
    const sorted = [...orders].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const firstHalf = sorted.slice(0, half).reduce((s, o) => s + o.total, 0);
    const secondHalf = sorted.slice(half).reduce((s, o) => s + o.total, 0);
    const trend = secondHalf > firstHalf ? "📈 Increasing" : "📉 Decreasing";
    insights.push({
      icon: secondHalf > firstHalf ? "📈" : "📉",
      title: "Spending Trend",
      value: trend.split(" ")[1],
      detail: `${Math.abs(((secondHalf - firstHalf) / firstHalf) * 100).toFixed(0)}% change`,
    });
  }

  // Most expensive day of week
  const dayCounts = new Array(7).fill(0);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const o of orders) {
    if (o.date) {
      const d = new Date(o.date).getDay();
      dayCounts[d] += o.total;
    }
  }
  const peakDay = dayCounts.indexOf(Math.max(...dayCounts));
  insights.push({
    icon: "🗓️",
    title: "Peak Spending Day",
    value: dayNames[peakDay],
    detail: formatEUR(dayCounts[peakDay]) + " total",
  });

  container.innerHTML = insights
    .map(
      (i) => `
    <div class="insight-card">
      <div class="insight-emoji">${i.icon}</div>
      <div class="insight-title">${i.title}</div>
      <div class="insight-value">${i.value}</div>
      <div class="insight-detail">${i.detail}</div>
    </div>
  `
    )
    .join("");
}

// ---- Top Orders ----
function renderTopOrders(orders) {
  const container = document.getElementById("top-orders");
  const top = [...orders].sort((a, b) => b.total - a.total).slice(0, 10);

  container.innerHTML = top
    .map((o, i) => {
      const name =
        o.items && o.items.length > 0 ? o.items[0] : o.orderNumber || "Order";
      const date = o.date
        ? new Date(o.date).toLocaleDateString("de-DE", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "";
      return `
      <div class="order-row">
        <div class="order-rank">${i + 1}</div>
        <div class="order-info">
          <div class="order-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="order-date">${date} · ${o.category}</div>
        </div>
        <div class="order-amount">${formatEUR(o.total)}</div>
      </div>
    `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Chart Defaults ----
function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { color: "rgba(42, 46, 61, 0.5)", drawBorder: false },
        ticks: { color: "#8b8fa3", font: { size: 10 } },
      },
      y: {
        grid: { color: "rgba(42, 46, 61, 0.5)", drawBorder: false },
        ticks: {
          color: "#8b8fa3",
          font: { size: 10 },
          callback: (v) =>
            v >= 1000 ? (v / 1000).toFixed(0) + "k" : v.toFixed(0),
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#1a1d27",
        titleColor: "#e4e6ed",
        bodyColor: "#e4e6ed",
        borderColor: "#2a2e3d",
        borderWidth: 1,
        padding: 8,
        cornerRadius: 8,
      },
    },
  };
}
