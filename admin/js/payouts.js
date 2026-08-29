// Phase 7: manual payouts.
//
// "Payable now" is computed live from affiliate_conversions (status =
// 'approved', not yet linked to a payout) rather than stored anywhere —
// there's no separate "balance" column to drift out of sync. Recording a
// payout calls record_manual_payout(), a Postgres function that
// atomically re-sums the live approved balance (locking those rows),
// inserts the affiliate_payouts row, and marks exactly those conversions
// 'paid' with payout_id set — so a stale number on screen can never
// under/over-pay, and two admins clicking at once can't double-pay the
// same commissions.

let currentView = "payable";
let payableCache = []; // [{affiliate, total}] — kept for CSV export

async function init() {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById("payoutTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    document.querySelectorAll("#payoutTabs .admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    document.getElementById("exportRow").style.display = currentView === "payable" ? "flex" : "none";
    render();
  });

  document.getElementById("exportCsvBtn").addEventListener("click", exportPayableCsv);
  document.getElementById("modalCancelBtn").addEventListener("click", closeModal);

  render();
}

async function render() {
  if (currentView === "payable") {
    await loadPayable();
  } else {
    await loadHistory();
  }
}

async function loadPayable() {
  const list = document.getElementById("payoutList");
  list.innerHTML = '<p class="state-msg">Loading…</p>';

  const { data: convs, error: convErr } = await affiliatesClient
    .from("affiliate_conversions")
    .select("affiliate_id, commission_amount")
    .eq("status", "approved");

  if (convErr) {
    list.innerHTML = '<p class="state-msg">Could not load approved commissions. Try refreshing.</p>';
    console.error(convErr);
    return;
  }

  const totals = new Map();
  for (const c of convs) {
    totals.set(c.affiliate_id, (totals.get(c.affiliate_id) || 0) + Number(c.commission_amount));
  }

  if (!totals.size) {
    payableCache = [];
    list.innerHTML = '<p class="state-msg">Nothing payable right now — every approved commission has already been paid out.</p>';
    return;
  }

  const affiliateIds = [...totals.keys()];
  const { data: affiliates, error: affErr } = await affiliatesClient
    .from("affiliates")
    .select("id, name, email, payout_method, payout_details")
    .in("id", affiliateIds);

  if (affErr) {
    list.innerHTML = '<p class="state-msg">Could not load affiliate details. Try refreshing.</p>';
    console.error(affErr);
    return;
  }

  const byId = new Map(affiliates.map((a) => [a.id, a]));
  payableCache = affiliateIds
    .map((id) => ({ affiliate: byId.get(id), total: totals.get(id) }))
    .filter((row) => row.affiliate)
    .sort((a, b) => b.total - a.total);

  list.innerHTML = payableCache.map(renderPayableCard).join("");
}

function renderPayableCard({ affiliate, total }) {
  const method = affiliate.payout_method ? escapeHtml(affiliate.payout_method) : "no payout method on file";
  return `
    <div class="payout-card" id="payable-${affiliate.id}">
      <div class="payout-card-info">
        <p class="payout-affiliate-name">${escapeHtml(affiliate.name)}</p>
        <p class="payout-affiliate-meta">${escapeHtml(affiliate.email)} · ${method}</p>
      </div>
      <div class="payout-amount">
        <span class="num">${formatInr(total)}</span>
        <button class="btn small" onclick="openModal('${affiliate.id}')">Record payout</button>
      </div>
    </div>`;
}

async function loadHistory() {
  const list = document.getElementById("payoutList");
  list.innerHTML = '<p class="state-msg">Loading…</p>';

  const { data, error } = await affiliatesClient
    .from("affiliate_payouts")
    .select("id, amount, method, status, notes, created_at, paid_at, affiliates(name, email)")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = '<p class="state-msg">Could not load payout history. Try refreshing.</p>';
    console.error(error);
    return;
  }

  if (!data.length) {
    list.innerHTML = '<p class="state-msg">No payouts recorded yet.</p>';
    return;
  }

  list.innerHTML = data.map(renderHistoryCard).join("");
}

function renderHistoryCard(p) {
  const who = p.affiliates ? `${escapeHtml(p.affiliates.name)} · ${escapeHtml(p.affiliates.email)}` : "(affiliate removed)";
  const when = p.paid_at ? new Date(p.paid_at).toLocaleDateString() : new Date(p.created_at).toLocaleDateString();
  return `
    <div class="payout-history-card">
      <div class="payout-history-top">
        <strong>${formatInr(p.amount)}</strong>
        <span class="payout-status">${escapeHtml(p.status)}</span>
      </div>
      <div class="payout-history-meta">${who}</div>
      <div class="payout-history-meta">${escapeHtml(p.method || "—")} · ${when}${p.notes ? " · " + escapeHtml(p.notes) : ""}</div>
    </div>`;
}

// ---------- Record payout modal ----------

let modalAffiliateId = null;

function openModal(affiliateId) {
  const row = payableCache.find((r) => r.affiliate.id === affiliateId);
  if (!row) return;
  modalAffiliateId = affiliateId;
  document.getElementById("modalSub").textContent =
    `${row.affiliate.name} — ${formatInr(row.total)} across all approved, unpaid commissions.`;
  document.getElementById("payoutMethod").value = row.affiliate.payout_method || "bank_transfer";
  document.getElementById("payoutNotes").value = "";
  document.getElementById("payoutModal").hidden = false;
}

function closeModal() {
  document.getElementById("payoutModal").hidden = true;
  modalAffiliateId = null;
}

document.getElementById("modalConfirmBtn")?.addEventListener("click", async () => {
  if (!modalAffiliateId) return;
  const btn = document.getElementById("modalConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Recording…";

  const method = document.getElementById("payoutMethod").value;
  const notes = document.getElementById("payoutNotes").value.trim() || null;

  const { error } = await affiliatesClient.rpc("record_manual_payout", {
    p_affiliate_id: modalAffiliateId,
    p_method: method,
    p_notes: notes,
  });

  btn.disabled = false;
  btn.textContent = "Confirm paid";

  if (error) {
    // Most likely: the approved balance changed (e.g. hit ₹0) between
    // opening this modal and confirming — refresh the list rather than
    // leaving a stale card showing an amount that's no longer accurate.
    alert(error.message || "Could not record this payout. The list will refresh.");
    closeModal();
    loadPayable();
    return;
  }

  closeModal();
  render();
});

// ---------- CSV export (payable list — for manual transfer batches / 194H record-keeping) ----------

function exportPayableCsv() {
  if (!payableCache.length) return;

  const rows = [["Name", "Email", "Payout method", "Payout details", "Amount (INR)"]];
  for (const { affiliate, total } of payableCache) {
    rows.push([
      affiliate.name,
      affiliate.email,
      affiliate.payout_method || "",
      affiliate.payout_details ? JSON.stringify(affiliate.payout_details) : "",
      total.toFixed(2),
    ]);
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mood-store-payables-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(val) {
  const str = String(val ?? "");
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

init();
