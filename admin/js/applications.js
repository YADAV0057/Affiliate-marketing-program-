let currentStatus = "pending";

async function init() {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById("statusTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    document.querySelectorAll(".admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    loadApplications();
  });

  loadApplications();
}

async function loadApplications() {
  const list = document.getElementById("appList");
  list.innerHTML = '<p class="state-msg">Loading…</p>';

  let query = affiliatesClient
    .from("affiliates")
    .select(
      "id, name, email, promotion_channel, application_note, status, ai_risk_label, ai_reasoning, ai_screened_at, applied_at, commission_rate",
    )
    .order("applied_at", { ascending: false });

  if (currentStatus !== "all") query = query.eq("status", currentStatus);

  const { data, error } = await query;

  if (error) {
    list.innerHTML = '<p class="state-msg">Could not load applications. Try refreshing.</p>';
    console.error(error);
    return;
  }

  if (!data.length) {
    list.innerHTML = '<p class="state-msg">Nothing here.</p>';
    return;
  }

  // Within "Needs review", surface higher-risk / unscreened applications
  // first — that's where a human's attention matters most. Other tabs
  // keep the default newest-first order from the query.
  if (currentStatus === "pending") {
    const weight = { high: 0, medium: 1, low: 2 };
    data.sort((a, b) => (weight[a.ai_risk_label] ?? -1) - (weight[b.ai_risk_label] ?? -1));
  }

  list.innerHTML = data.map(renderCard).join("");
}

function renderCard(app) {
  const riskLabel = app.ai_risk_label || "unscreened";
  const riskBadge = `<span class="risk-badge ${riskLabel}">${riskLabel === "unscreened" ? "Not screened" : riskLabel + " risk"}</span>`;

  const actions = [];
  if (app.status !== "approved") {
    actions.push(`<button class="btn small" onclick="decide('${app.id}','approved')">Approve</button>`);
  }
  if (app.status !== "rejected") {
    actions.push(`<button class="btn small reject" onclick="decide('${app.id}','rejected')">Reject</button>`);
  }
  if (app.status === "approved") {
    actions.push(`<button class="btn small secondary" onclick="decide('${app.id}','suspended')">Suspend</button>`);
  }
  if (app.status === "suspended") {
    actions.push(`<button class="btn small" onclick="decide('${app.id}','approved')">Reactivate</button>`);
  }

  return `
    <div class="admin-app-card" id="app-${app.id}">
      <div class="admin-app-top">
        <div>
          <p class="admin-app-name">${escapeHtml(app.name)}</p>
          <p class="admin-app-email">${escapeHtml(app.email)} · applied ${new Date(app.applied_at).toLocaleDateString()}</p>
        </div>
        ${riskBadge}
      </div>
      <div class="admin-app-field">
        <strong>Promotion channel</strong>
        ${escapeHtml(app.promotion_channel || "—")}
      </div>
      <div class="admin-app-field">
        <strong>Application note</strong>
        ${escapeHtml(app.application_note || "—")}
      </div>
      ${app.ai_reasoning ? `<div class="admin-app-reasoning">AI: ${escapeHtml(app.ai_reasoning)}</div>` : ""}
      <div class="admin-app-actions">${actions.join("")}</div>
    </div>`;
}

async function decide(id, status) {
  const card = document.getElementById("app-" + id);
  card.style.opacity = "0.5";

  const update = { status };
  if (status === "approved") update.approved_at = new Date().toISOString();

  const { error } = await affiliatesClient.from("affiliates").update(update).eq("id", id);

  if (error) {
    card.style.opacity = "1";
    alert("Could not update this application. Try again.");
    return;
  }

  loadApplications();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

init();
