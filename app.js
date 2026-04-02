const chatLog = document.querySelector("#chat-log");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const resetButton = document.querySelector("#reset-button");
const resultCard = document.querySelector("#result-card");
const detectedCategory = document.querySelector("#detected-category");
const detectedRule = document.querySelector("#detected-rule");
const nextQuestion = document.querySelector("#next-question");
const valuePills = document.querySelector("#value-pills");
const debugPanel = document.querySelector("#debug-panel");
const debugSource = document.querySelector("#debug-source");
const debugStatus = document.querySelector("#debug-status");
const debugJson = document.querySelector("#debug-json");

const appState = {
  history: [],
  caseState: {
    categoryId: null,
    ruleId: null,
    values: {},
    lastQuestion: ""
  },
  latestResult: null,
  source: null,
  previewActive: true,
  lastPayload: null,
  lastError: null,
  isSubmitting: false,
  debugEnabled: false
};

const previewConversation = [
  { role: "user", content: "헬스장 1년권 120만원 결제했는데 2개월 다니고 환불하고 싶어요." }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeChatContent(value) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function renderPreviewConversation() {
  chatLog.innerHTML = "";
  for (const item of previewConversation) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${item.role} preview`;
    wrapper.innerHTML = `<div class="chat-bubble">${escapeHtml(normalizeChatContent(item.content))}</div>`;
    chatLog.appendChild(wrapper);
  }
  chatLog.scrollTop = 0;
}

function addMessage(role, content) {
  const normalizedContent = normalizeChatContent(content);
  if (!normalizedContent) return;
  if (appState.previewActive) {
    appState.previewActive = false;
    chatLog.innerHTML = "";
  }
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = `<div class="chat-bubble">${escapeHtml(normalizedContent)}</div>`;
  chatLog.appendChild(wrapper);
  chatLog.scrollTop = chatLog.scrollHeight;
  appState.history.push({ role, content: normalizedContent });
}

function submitCurrentMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  chatForm.requestSubmit();
}

function resetConversation() {
  appState.history = [];
  appState.caseState = {
    categoryId: null,
    ruleId: null,
    values: {},
    lastQuestion: ""
  };
  appState.latestResult = null;
  appState.source = null;
  appState.previewActive = true;
  appState.lastPayload = null;
  appState.lastError = null;
  appState.isSubmitting = false;
  chatInput.disabled = false;
  renderPreviewConversation();

  renderState();
  renderResult(null);
  renderDebug();
}

async function sendChat(message) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      history: appState.history,
      caseState: appState.caseState
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "서버 호출에 실패했습니다.");
  }

  return response.json();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("config_unavailable");
    const config = await response.json();
    appState.debugEnabled = Boolean(config?.debugEnabled);
  } catch {
    appState.debugEnabled = false;
  }

  debugPanel.hidden = !appState.debugEnabled;
}

function renderState() {
  detectedCategory.textContent = appState.caseState.categoryName || appState.caseState.categoryId || "아직 미확정";
  detectedRule.textContent = appState.caseState.ruleName || appState.caseState.ruleId || "아직 미확정";
  nextQuestion.textContent = appState.caseState.lastQuestion || "진행 중";

  const entries = Object.entries(appState.caseState.values || {}).filter(
    ([, value]) => value != null && value !== ""
  );

  if (!entries.length) {
    valuePills.innerHTML = `<span class="empty-pill">아직 없음</span>`;
    return;
  }

  valuePills.innerHTML = entries
    .map(([key, value]) => `<span class="pill">${escapeHtml(key)}: ${escapeHtml(formatValue(key, value))}</span>`)
    .join("");
}

function renderDebug() {
  if (!appState.debugEnabled) return;

  debugSource.textContent = appState.source || "대기 중";
  debugStatus.textContent = appState.lastError
    ? `오류: ${appState.lastError}`
    : appState.lastPayload
      ? "응답 수신"
      : "아직 호출 없음";

  if (appState.lastError) {
    debugJson.textContent = appState.lastError;
    return;
  }

  if (!appState.lastPayload) {
    debugJson.textContent = "대기 중";
    return;
  }

  debugJson.textContent = JSON.stringify(appState.lastPayload, null, 2);
}

function formatValue(key, value) {
  if (/(price|fee|cost|income)/i.test(key)) {
    return formatCurrency(value);
  }
  if (/Days/.test(key)) return `${value}일`;
  if (/Months/.test(key)) return `${value}개월`;
  if (/Count/.test(key)) return `${value}회`;
  return String(value);
}

function renderResult(result) {
  if (!result) {
    resultCard.classList.add("empty");
    resultCard.innerHTML = `<p class="result-empty">상담이 진행되면 여기서 예상 환급·배상 기준을 보여드립니다.</p>`;
    return;
  }

  const statusClass = result.kind === "amount" ? "amount" : "guide";
  const statusLabel = result.kind === "amount" ? "금액 계산 완료" : "처리기준 안내";
  const amountHtml = result.kind === "amount" ? `<p class="result-amount">${escapeHtml(result.amountLabel)}</p>` : "";

  resultCard.classList.remove("empty");
  resultCard.innerHTML = `
    <div class="result-status ${statusClass}">${statusLabel}</div>
    <h3 class="result-title">${escapeHtml(result.title)}</h3>
    ${amountHtml}
    <p class="result-rule">${escapeHtml(result.summary)}</p>

    <div class="meta-row">
      <span class="meta-pill">${escapeHtml(result.categoryName || "")}</span>
      <span class="meta-pill">${escapeHtml(result.ruleName || "")}</span>
    </div>

    <p class="section-label">계산 근거</p>
    <ul class="breakdown">
      ${(result.breakdown || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>

    <p class="section-label">규정 포인트</p>
    <ul class="reference-list">
      ${(result.references || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (appState.isSubmitting) return;

  const message = normalizeChatContent(chatInput.value);
  if (!message) return;

  appState.isSubmitting = true;
  chatInput.disabled = true;
  addMessage("user", message);
  chatInput.value = "";

  try {
    const payload = await sendChat(message);
    appState.lastPayload = payload;
    appState.lastError = null;
    appState.caseState = payload.caseState || appState.caseState;
    appState.latestResult = payload.result || null;
    appState.source = payload.source || null;
    addMessage("assistant", payload.assistantMessage || "답변을 가져오지 못했습니다.");
    renderState();
    renderResult(appState.latestResult);
    renderDebug();
  } catch (error) {
    appState.lastError = error.message;
    appState.lastPayload = null;
    addMessage("assistant", `오류가 발생했습니다: ${error.message}`);
    renderDebug();
  } finally {
    appState.isSubmitting = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (event.isComposing || event.keyCode === 229) return;
  if (event.altKey) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;
  if (appState.isSubmitting) return;

  event.preventDefault();
  submitCurrentMessage();
});

resetButton.addEventListener("click", () => {
  resetConversation();
});

loadConfig().finally(() => {
  resetConversation();
});
