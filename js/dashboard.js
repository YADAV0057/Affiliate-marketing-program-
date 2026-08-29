async function loadDashboard() {
  const affiliate = await requireApprovedAffiliate();
  if (!affiliate) return;

  document.getElementById("welcomeLine").textContent =
    affiliate.name + " · " + affiliate.commission_rate + "% commission";

  const { data: conversions, error } = await affiliatesClient
    .from("affiliate_conversions")
    .select("product_slug, order_total, commission_amount, status")
    .eq("affiliate_id", affiliate.id);

  if (error) {
    document.getElementById("productBreakdown").innerHTML =
      '<p class="state-msg">Could not load your sales right now. Try refreshing.</p>';
    return;
  }

  let approvedTotal = 0;
  let pendingTotal = 0;
  let units = 0;
  const byProduct = {};

  for (const c of conversions) {
    if (c.status === "approved" || c.status === "paid") {
      approvedTotal += Number(c.commission_amount);
      units += 1;
    } else if (c.status === "pending") {
      pendingTotal += Number(c.commission_amount);
      units += 1;
    }
    if (c.status !== "rejected") {
      if (!byProduct[c.product_slug]) byProduct[c.product_slug] = { count: 0, commission: 0 };
      byProduct[c.product_slug].count += 1;
      byProduct[c.product_slug].commission += Number(c.commission_amount);
    }
  }

  document.getElementById("totalEarned").textContent = formatInr(approvedTotal);
  document.getElementById("pendingEarned").textContent = formatInr(pendingTotal);
  document.getElementById("unitsSold").textContent = units;

  const rows = Object.entries(byProduct).sort((a, b) => b[1].commission - a[1].commission);

  const container = document.getElementById("productBreakdown");
  if (!rows.length) {
    container.innerHTML =
      '<p class="state-msg">No sales yet. Head to "Get links" to start promoting a product.</p>';
    return;
  }

  container.innerHTML = rows
    .map(
      ([slug, r]) => `
      <div class="panel">
        <div class="panel-corner"></div>
        <div class="panel-row">
          <span>${slug}</span>
          <span class="num">${formatInr(r.commission)}</span>
        </div>
        <div class="panel-row">
          <span>Orders</span>
          <span class="num">${r.count}</span>
        </div>
      </div>`,
    )
    .join("");
}

loadDashboard();
