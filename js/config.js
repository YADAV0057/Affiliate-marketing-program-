// Shared Supabase clients + helpers for the Mood Store affiliate portal.
// Loaded on every page (index.html, dashboard.html, links.html) before the
// page-specific script.

const AFFILIATES_SUPABASE_URL = "https://yrrficomytctlpypdkpy.supabase.co";
const AFFILIATES_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycmZpY29teXRjdGxweXBka3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NzcwNDQsImV4cCI6MjEwMzU1MzA0NH0.QruZu6sgQuC1xlT0JLkLx0WHBTDrtVTml_-bDcFeEh0";

const STORE_SUPABASE_URL = "https://uvperhzhnosjtkwxxnte.supabase.co";
const STORE_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cGVyaHpobm9zanRrd3h4bnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjQ2NzMsImV4cCI6MjA5OTQ0MDY3M30.oq8MY6Z6QrdWAL8djO0TtuUbDQbKLng6AC7kZRAB2zk";

const STORE_SLUG = "moodstore";

const affiliatesClient = window.supabase.createClient(
  AFFILIATES_SUPABASE_URL,
  AFFILIATES_SUPABASE_ANON_KEY,
);
const storeClient = window.supabase.createClient(
  STORE_SUPABASE_URL,
  STORE_SUPABASE_ANON_KEY,
);

// Resolves the public-safe row for the "moodstore" store (id, slug, name,
// site_url, is_active) via the get_public_store() RPC. Used to build
// tracked links (needs site_url) and to attach store_id to new
// affiliate_product_links rows.
async function getPublicStore() {
  const { data, error } = await affiliatesClient.rpc("get_public_store", {
    p_slug: STORE_SLUG,
  });
  if (error || !data || !data.length) {
    throw new Error("Could not resolve store details");
  }
  return data[0];
}

// Auth guard for dashboard.html / links.html.
// - No session at all -> bounce to index.html.
// - Signed in but no affiliate row / not approved -> render a status
//   banner explaining why, hide the page chrome, return null.
// - Approved -> returns the affiliate row (id, name, email, status,
//   commission_rate) for the page to use.
async function requireApprovedAffiliate() {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "index.html";
    return null;
  }

  const { data: affiliate, error } = await affiliatesClient
    .from("affiliates")
    .select("id, name, email, status, commission_rate")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !affiliate) {
    renderStatusBanner(
      "No application found",
      "You're signed in, but there's no affiliate application on this account.",
      true,
    );
    return null;
  }

  if (affiliate.status === "pending") {
    renderStatusBanner(
      "Application pending",
      "Your affiliate application is awaiting review. You'll be able to generate links and see earnings once it's approved.",
    );
    return null;
  }

  if (affiliate.status === "rejected") {
    renderStatusBanner(
      "Application not approved",
      "Your affiliate application wasn't approved. Reach out to the store if you think this is a mistake.",
    );
    return null;
  }

  if (affiliate.status === "suspended") {
    renderStatusBanner(
      "Account suspended",
      "Your affiliate account is currently on hold. Reach out to the store for details.",
    );
    return null;
  }

  return affiliate;
}

function renderStatusBanner(title, body, showApplyLink) {
  document
    .querySelectorAll(".portal-main, .tab-bar")
    .forEach((el) => (el.style.display = "none"));
  const banner = document.createElement("div");
  banner.className = "status-banner";
  const applyLink = showApplyLink
    ? '<a href="index.html?apply=1" class="btn small" style="margin-right:8px">Apply now</a>'
    : "";
  banner.innerHTML = `<strong>${title}</strong><p>${body}</p><div class="status-banner-actions">${applyLink}<button class="btn secondary small" id="signOutBtn">Sign out</button></div>`;
  document.body.appendChild(banner);
}

async function signOutAndRedirect() {
  await affiliatesClient.auth.signOut();
  window.location.href = "index.html";
}

// Delegated so it works whether the "Sign out" button is the one in the
// nav (present on dashboard/links) or the one rendered inside a status
// banner (present when auth-guard blocks the page).
document.addEventListener("click", (e) => {
  if (e.target.id === "signOutBtn") signOutAndRedirect();
});

function formatInr(amount) {
  return "₹" + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
