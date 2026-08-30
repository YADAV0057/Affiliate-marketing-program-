// Phase 9: fraud review UI.
//
// The actual fraud logic (self-referral auto-reject, IP-cluster flagging,
// dedupe-by-order-id) already runs server-side in the record-conversion
// edge function — this page is just the missing piece that let it flow
// out to a human: until now flag_reason/flagged_at sat in the DB with no
// admin surface, so a self-referral or IP-cluster flag was invisible
// unless someone queried Supabase directly.
//
// "Flagged" tab: conversions where flag_reason is set.
//   - self_referral: already auto-rejected, no commission paid. Shown for
//     audit/transparency; the only action is a manual "Reverse" in case
//     it's a false positive (e.g. an affiliate legitimately shares an
//     email with a family member's account — rare, but possible).
//   - ip_cluster: still status='pending' — this is a review signal, not a
//     verdict. Approve or Reject moves it out of limbo.
// "All conversions" tab: everything, newest first, read-only — for
// general visibility/audit, same spirit as payout history.

let currentView = "flagged";

async function init() {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById("convTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    document.querySelectorAll("#convTabs .admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    load();
  });

  load();
}

async function load() {
  const list = document.getElementById("convList");
  list.innerHTML = '<p class="state-msg">Loading…</p>';

  let query = affiliatesClient
    .from("affiliate_conversions")
    .select(
      "id, order_id, order_total, commission_amount, status, flag_reason, flagged_at, created_at, product_slug, affiliates(name, email)",
    );

  if (currentView === "flagged") {
    query = query.not("flag_reason", "is", null).order("flagged_at", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false }).limit(200);
  }

  const { data, error } = await query;

  if (error) {
    list.innerHTML = '<p class="state-msg">Could not load conversions. Try refreshing.</p>';
    console.error(error);
    return;
  }

  if (!data.length) {
    list.innerHTML =
      currentView === "flagged"
        ? '<p class="state-msg">Nothing flagged — no self-referrals or IP clusters caught so far.</p>'
        : '<p class="state-msg">No conversions recorded yet.</p>';
    return;
  }

  list.innerHTML = data.map(renderCard).join("");
}

function renderCard(c) {
  const who = c.affiliates ? `${escapeHtml(c.affiliates.name)} · ${escapeHtml(c.affiliates.email)}` : "(affiliate removed)";
  const when = new Date(c.created_at).toLocaleDateString();

  let flagBadge = "";
  if (c.flag_reason === "self_referral") {
    flagBadge = '<span class="risk-badge high">Self-referral</span>';
  } else if (c.flag_reason === "ip_cluster") {
    flagBadge = '<span class="risk-badge medium">IP cluster</span>';
  }
  const statusBadge = `<span class="risk-badge ${statusClass(c.status)}">${escapeHtml(c.status)}</span>`;

  const actions = [];
  if (c.flag_reason === "ip_cluster" && c.status === "pending") {
    actions.push(`<button class="btn small" onclick="decide('${c.id}','approved')">Approve</button>`);
    actions.push(`<button class="btn small reject" onclick="decide('${c.id}','rejected')">Reject</button>`);
  } else if (c.flag_reason === "self_referral" && c.status === "rejected") {
    actions.push(`<button class="btn small secondary" onclick="decide('${c.id}','approved')">Reverse — mark approved</button>`);
  }

  return `
    <div class="admin-app-card" id="conv-${c.id}">
      <div class="admin-app-top">
        <div>
          <p class="admin-app-name">${who}</p>
          <p class="admin-app-email">Order ${escapeHtml(c.order_id)} · ${escapeHtml(c.product_slug || "—")} · ${when}</p>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">${flagBadge}${statusBadge}</div>
      </div>
      <div class="admin-app-field">
        <strong>Order total / commission</strong>
        ${formatInr(c.order_total)} / ${formatInr(c.commission_amount)}
      </div>
      ${c.flagged_at ? `<div class="admin-app-reasoning">Flagged ${new Date(c.flagged_at).toLocaleString()}</div>` : ""}
      ${actions.length ? `<div class="admin-app-actions">${actions.join("")}</div>` : ""}
    </div>`;
}

function statusClass(status) {
  if (status === "approved" || status === "paid") return "low";
  if (status === "rejected") return "high";
  return "medium"; // pending
}

async function decide(id, status) {
  const card = document.getElementById("conv-" + id);
  if (card) card.style.opacity = "0.5";

  const update = { status };
  if (status === "approved") update.approved_at = new Date().toISOString();

  const { error } = await affiliatesClient.from("affiliate_conversions").update(update).eq("id", id);

  if (error) {
    if (card) card.style.opacity = "1";
    alert("Could not update this conversion. Try again.");
    return;
  }

  load();
}

function formatInr(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

init();
