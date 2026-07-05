const list = document.getElementById("leadList");
const grid = document.getElementById("summaryGrid");
const refresh = document.getElementById("refreshButton");
const exportButton = document.getElementById("exportButton");
let scoresRecalculated = false;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function summaryCard(label, value) {
  return `<div class="summary-card"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;
}

function leadCard(lead) {
  const quality = ["hot", "warm", "cold"].includes(lead.leadQuality)
    ? lead.leadQuality
    : "";

  const answered = Number(lead.answeredQuestionCount || 0);
  const possible = Number(lead.possibleQuestionCount || 0);
  const scoreText = possible > 0 ? `${answered}/${possible}` : String(answered);

  const items = [
    ["Phone", lead.phone],
    ["Email", lead.email || "unknown"],
    ["Intent", lead.intent],
    ["Purpose", lead.purpose],
    ["Area", lead.preferredArea],
    ["Budget", lead.budget],
    ["Timeline", lead.timeline],
    ["Payment", lead.paymentMethod],
    ["WhatsApp", lead.whatsappNumber],
    ["Follow-up time", lead.bestFollowUpTime],
    ["Positive answers", scoreText],
    ["Sentiment", lead.callerSentiment],
    ["Status", lead.status],
    ["Analysis", lead.rawStructuredOutput?.source || "unknown"]
  ];

  return `
    <article class="lead-card ${quality}" data-lead-id="${esc(lead._id)}">
      <div class="lead-topline">
        <div>
          <h2>${esc(lead.name || "Unknown lead")}</h2>
          <div class="meta-item">${esc(new Date(lead.createdAt).toLocaleString())}</div>
        </div>
        <div class="lead-actions">
          <span class="badge">${esc(lead.leadQuality || lead.status || "unknown")}</span>
          <button class="delete-button" type="button" data-delete-id="${esc(lead._id)}">Delete</button>
        </div>
      </div>

      <div class="meta-grid">
        ${items.map(([label, value]) => `<div class="meta-item"><strong>${esc(label)}:</strong> ${esc(value || "unknown")}</div>`).join("")}
      </div>

      <p><strong>Summary:</strong> ${esc(lead.summary || "Analysis pending.")}</p>
      <p><strong>Next step:</strong> ${esc(lead.nextStep || "Not available.")}</p>
      <details>
        <summary>Transcript</summary>
        <pre>${esc(lead.transcript || "No transcript captured yet.")}</pre>
      </details>
    </article>`;
}

async function load() {
  refresh.disabled = true;

  try {
    if (!scoresRecalculated) {
      await fetch("/api/leads/recalculate-scores", { method: "POST" });
      scoresRecalculated = true;
    }

    const response = await fetch("/api/leads");
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Unable to load leads.");
    }

    const leads = data.leads;
    const counts = {
      total: leads.length,
      hot: leads.filter((lead) => lead.leadQuality === "hot").length,
      warm: leads.filter((lead) => lead.leadQuality === "warm").length,
      cold: leads.filter((lead) => lead.leadQuality === "cold").length
    };

    grid.innerHTML =
      summaryCard("Total leads", counts.total) +
      summaryCard("Hot", counts.hot) +
      summaryCard("Warm", counts.warm) +
      summaryCard("Cold", counts.cold);

    list.innerHTML = leads.length
      ? leads.map(leadCard).join("")
      : '<div class="empty-state">No leads yet. Complete a Talk to Kenny call first.</div>';
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`;
  } finally {
    refresh.disabled = false;
  }
}

async function deleteLead(id, button) {
  const confirmed = window.confirm("Delete this lead permanently?");
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Deleting...";

  try {
    const response = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Unable to delete lead.");
    }

    await load();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
    button.textContent = "Delete";
  }
}

list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-id]");
  if (!button) return;
  deleteLead(button.dataset.deleteId, button);
});

refresh.addEventListener("click", load);
exportButton.addEventListener("click", () => {
  window.location.href = "/api/leads/export.csv";
});

load();
setInterval(load, 15000);
