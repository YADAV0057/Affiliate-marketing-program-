// Marketing Bot admin UI (Creator Outreach & Marketing Bot — Step 1
// interim via Make.com, Step 4 content generation).
//
// Same conventions as applications.js / conversions.js: affiliatesClient
// global from ../js/config.js, requireAdmin() guard from
// admin-auth-guard.js, admin-tabs for filtering, admin-app-card markup
// reused for content cards, risk-badge reused for status pills.
//
// Kill-switch (bot_settings.paused) starts true by default — nothing
// posts autonomously until an admin explicitly flips it off here, per
// the project plan's Step 0 recommendation (dry run before going live).

const FUNCTIONS_URL = "https://yrrficomytctlpypdkpy.supabase.co/functions/v1/generate-marketing-content";

let currentStatus = "draft";

async function init() {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById("marketingTabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    document.querySelectorAll("#marketingTabs .admin-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    loadContent();
  });

  document.getElementById("killSwitchToggle").addEventListener("click", toggleKillSwitch);
  document.getElementById("generateBtn").addEventListener("click", generateContent);

  loadKillSwitch();
  loadContent();
}

// ---------- Kill-switch ----------

async function loadKillSwitch() {
  const { data, error } = await affiliatesClient
    .from("bot_settings")
    .select("paused")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    document.getElementById("killSwitchLabel").textContent = "Could not load kill-switch status.";
    return;
  }

  renderKillSwitch(data?.paused ?? true);
}

function renderKillSwitch(paused) {
  const label = document.getElementById("killSwitchLabel");
  const toggle = document.getElementById("killSwitchToggle");

  label.textContent = paused
    ? "⏸ Kill-switch is ON — bot will not post autonomously."
    : "▶ Kill-switch is OFF — bot can post autonomously once wired to the publish pipeline.";
  label.className = paused ? "state-msg" : "state-msg live";

  toggle.disabled = false;
  toggle.textContent = paused ? "Turn bot on" : "Pause bot";
  toggle.className = paused ? "btn small" : "btn small reject";
  toggle.dataset.paused = paused ? "true" : "false";
}

async function toggleKillSwitch() {
  const toggle = document.getElementById("killSwitchToggle");
  const newPaused = toggle.dataset.paused !== "true";

  toggle.disabled = true;
  const { error } = await affiliatesClient
    .from("bot_settings")
    .update({ paused: newPaused, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    alert("Could not update the kill-switch. Try again.");
    toggle.disabled = false;
    return;
  }

  renderKillSwitch(newPaused);
}

// ---------- Content list ----------

async function loadContent() {
  const list = document.getElementById("marketingList");
  list.innerHTML = '<p class="state-msg">Loading…</p>';

  let query = affiliatesClient
    .from("marketing_content")
    .select("id, product_slug, platform, caption, hashtags, image_url, status, platform_post_id, generated_at, posted_at")
    .order("generated_at", { ascending: false });

  if (currentStatus !== "all") query = query.eq("status", currentStatus);

  const { data, error } = await query;

  if (error) {
    list.innerHTML = '<p class="state-msg">Could not load marketing content. Try refreshing.</p>';
    console.error(error);
    return;
  }

  if (!data.length) {
    list.innerHTML =
      currentStatus === "draft"
        ? '<p class="state-msg">No drafts yet — click "Generate content now" to create some from the live catalogue.</p>'
        : '<p class="state-msg">Nothing here.</p>';
    return;
  }

  list.innerHTML = data.map(renderCard).join("");
}

function renderCard(row) {
  const hashtags = Array.isArray(row.hashtags) ? row.hashtags.join(" ") : "";
  const when = new Date(row.generated_at).toLocaleDateString();
  const statusBadge = `<span class="risk-badge ${statusClass(row.status)}">${escapeHtml(row.status)}</span>`;

  const actions = [];
  if (row.status === "draft") {
    actions.push(`<button class="btn small" onclick="setStatus('${row.id}','queued')">Queue for posting</button>`);
  }
  if (row.status === "queued") {
    actions.push(`<button class="btn small secondary" onclick="setStatus('${row.id}','draft')">Un-queue</button>`);
  }
  if (row.status === "failed") {
    actions.push(`<button class="btn small" onclick="setStatus('${row.id}','draft')">Reset to draft</button>`);
  }
  actions.push(`<button class="btn small reject" onclick="deleteContent('${row.id}')">Delete</button>`);

  const image = row.image_url
    ? `<img src="${escapeHtml(row.image_url)}" alt="${escapeHtml(row.product_slug)}" class="admin-app-thumb" loading="lazy" />`
    : `<div class="admin-app-thumb admin-app-thumb-empty">No image</div>`;

  return `
    <div class="admin-app-card" id="mk-${row.id}">
      <div class="admin-app-top">
        <div class="admin-app-top-left">
          ${image}
          <div>
            <p class="admin-app-name">${escapeHtml(row.product_slug)} · ${escapeHtml(row.platform)}</p>
            <p class="admin-app-email">Generated ${when}${row.posted_at ? " · posted " + new Date(row.posted_at).toLocaleDateString() : ""}</p>
          </div>
        </div>
        ${statusBadge}
      </div>
      <div class="admin-app-field">
        <strong>Caption</strong>
        ${escapeHtml(row.caption || "(no caption)")}
      </div>
      ${hashtags ? `<div class="admin-app-field"><strong>Hashtags</strong>${escapeHtml(hashtags)}</div>` : ""}
      ${row.platform_post_id ? `<div class="admin-app-reasoning">Live post ID: ${escapeHtml(row.platform_post_id)}</div>` : ""}
      <div class="admin-app-actions">${actions.join("")}</div>
    </div>`;
}

function statusClass(status) {
  if (status === "posted") return "low";
  if (status === "failed") return "high";
  return "medium"; // draft / queued / ready_for_video
}

async function setStatus(id, status) {
  const card = document.getElementById("mk-" + id);
  if (card) card.style.opacity = "0.5";

  const { error } = await affiliatesClient.from("marketing_content").update({ status }).eq("id", id);

  if (error) {
    if (card) card.style.opacity = "1";
    alert("Could not update this item. Try again.");
    return;
  }

  loadContent();
}

async function deleteContent(id) {
  if (!confirm("Delete this content permanently? This cannot be undone.")) return;

  const { error } = await affiliatesClient.from("marketing_content").delete().eq("id", id);

  if (error) {
    alert("Could not delete this item. Try again.");
    return;
  }

  loadContent();
}

// ---------- Generate content ----------

async function generateContent() {
  const btn = document.getElementById("generateBtn");
  btn.disabled = true;
  btn.textContent = "Generating…";

  try {
    const {
      data: { session },
    } = await affiliatesClient.auth.getSession();

    const res = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const result = await res.json();

    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

    const generated = result.generated ?? 0;
    const failedCount = result.failed ?? 0;
    const skipped = result.skipped ?? 0;

    if (generated > 0) {
      alert(
        `Generated ${generated} new item(s)` +
          (skipped ? `, ${skipped} already existed` : "") +
          (failedCount ? `, ${failedCount} failed — check Supabase logs` : "") +
          `. Check the Draft tab.`
      );
    } else if (failedCount > 0) {
      alert(`Generation failed for all ${failedCount} item(s) — check Supabase logs for generate-marketing-content.`);
    } else {
      alert(`Nothing to generate — all content already exists. Check the Draft tab.`);
    }

    currentStatus = "draft";
    document.querySelectorAll("#marketingTabs .admin-tab").forEach((t) => t.classList.remove("active"));
    document.querySelector('#marketingTabs .admin-tab[data-status="draft"]').classList.add("active");
    loadContent();
  } catch (err) {
    console.error(err);
    alert("Content generation failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generate content now";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

init();
