// Shared Supabase clients + helpers for the Mood Store affiliate portal.
// Loaded on every page (index.html = public catalogue, auth.html,
// dashboard.html, links.html) before the page-specific script.

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
// - No session at all -> bounce to auth.html.
// - Signed in but no affiliate row / not approved -> render a status
//   banner explaining why, hide the page chrome, return null.
// - Approved -> returns the affiliate row (id, name, email, status,
//   commission_rate) for the page to use.
async function requireApprovedAffiliate() {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "auth.html";
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

  // If they arrived here via a "Promote this product" click on the public
  // catalogue while already approved, send them straight to the product
  // picker instead of the dashboard.
  const intentSlug = sessionStorage.getItem("promoteIntentSlug");
  if (intentSlug && affiliate.status === "approved" && !location.pathname.endsWith("links.html")) {
    window.location.href = "links.html";
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

// Phase 4c: auth guard for links.html specifically. Unlike
// requireApprovedAffiliate(), this lets a *pending* affiliate see the page
// (read-only product preview, no link generation) instead of bouncing them
// to a generic status banner — so someone who just applied to promote a
// specific product actually sees that product, not a dead end. Rejected /
// suspended / no-application affiliates are still fully blocked, same as
// before.
async function requireAffiliateForLinks() {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "auth.html";
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

  // approved or pending both fall through to the page; links.js decides
  // what to render for each.
  return affiliate;
}

function renderStatusBanner(title, body, showApplyLink) {
  document
    .querySelectorAll(".portal-main, .tab-bar")
    .forEach((el) => (el.style.display = "none"));
  const banner = document.createElement("div");
  banner.className = "status-banner";
  const applyLink = showApplyLink
    ? '<a href="auth.html?apply=1" class="btn small" style="margin-right:8px">Apply now</a>'
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

// ---------- Public catalogue (index.html) ----------
// No auth required — reads store_products directly with the anon key,
// same trust boundary as the storefront itself. Must never be routed
// through requireApprovedAffiliate() or any JWT-gated query.

async function getPublicCatalogue() {
  const { data, error } = await storeClient
    .from("store_products")
    .select("slug, name, price_inr, image_url")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error("Could not load the product catalog");
  return data || [];
}

// Called when someone clicks "Promote this product" on the public
// catalogue. Remembers which product they meant (so links.html can land
// them on it later) and routes them to the right next step depending on
// whether they're already signed in and approved.
async function resolvePromoteDestination(slug) {
  sessionStorage.setItem("promoteIntentSlug", slug);

  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "auth.html?apply=1";
    return;
  }

  await postAuthRedirect();
}

// Shared "where should this signed-in person land" logic, used both by
// resolvePromoteDestination (already signed in, clicked Promote) and by
// auth.html after a successful sign-in / apply. Does NOT clear the stored
// intent — links.html's own load does that once it actually uses it.
async function postAuthRedirect() {
  const intentSlug = sessionStorage.getItem("promoteIntentSlug");
  if (!intentSlug) {
    window.location.href = "dashboard.html";
    return;
  }

  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "dashboard.html";
    return;
  }

  const { data: affiliate } = await affiliatesClient
    .from("affiliates")
    .select("status")
    .eq("user_id", session.user.id)
    .maybeSingle();

  // Phase 4c: a newly-applied (pending) affiliate with a promote-intent
  // still goes to links.html, same as an approved one — they just see a
  // read-only preview of the product they wanted, instead of getting
  // dropped on a generic "application pending" banner with no context.
  // Only rejected/suspended/no-application affiliates fall back to
  // dashboard.html, where the real reason is explained.
  const status = affiliate && affiliate.status;
  window.location.href = status === "approved" || status === "pending" ? "links.html" : "dashboard.html";
}

// Reads + clears any pending "promote this product" intent. Called once by
// links.html on load to decide which card to scroll to/highlight.
function consumePromoteIntent() {
  const slug = sessionStorage.getItem("promoteIntentSlug");
  sessionStorage.removeItem("promoteIntentSlug");
  return slug;
}

// ---------- Phase 4b: email-OTP signup/apply ----------
// sessionStorage doesn't survive the magic-link hop when the link is opened
// in a different tab/browser context than where it was requested (e.g. an
// email app's in-app browser). As a fallback, the intended product slug is
// also carried as a ?promote= query param on the redirect URL itself; this
// restores it into sessionStorage on landing so postAuthRedirect/links.html
// still work even when sessionStorage didn't carry over.
function restorePromoteIntentFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("promote");
  if (slug && !sessionStorage.getItem("promoteIntentSlug")) {
    sessionStorage.setItem("promoteIntentSlug", slug);
  }
}

// Builds the emailRedirectTo URL for signInWithOtp: back to auth.html on
// this same deployment, carrying the promote-intent slug (if any) as a
// query param so it survives even if sessionStorage doesn't.
function buildAuthRedirectUrl() {
  const url = new URL("auth.html", window.location.origin + window.location.pathname.replace(/[^/]+$/, ""));
  const intentSlug = sessionStorage.getItem("promoteIntentSlug");
  if (intentSlug) url.searchParams.set("promote", intentSlug);
  return url.toString();
}

// Ensures a signed-in user has an affiliate application row. Called after
// any successful email-OTP verification (fresh magic-link landing, or a
// session that already existed). Creating the account IS applying, so this
// always inserts a 'pending' row if one doesn't exist yet — never blocks on
// a missing name (falls back to the email's local part) so a returning
// verify-only session can't get stuck.
async function ensureAffiliateApplication(fallbackName) {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();
  if (!session) return { affiliate: null, error: "no_session" };

  const { data: existing } = await affiliatesClient
    .from("affiliates")
    .select("id, status")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (existing) return { affiliate: existing, error: null };

  const name =
    session.user.user_metadata?.name ||
    fallbackName ||
    (session.user.email || "").split("@")[0];

  const { data: inserted, error } = await affiliatesClient
    .from("affiliates")
    .insert({ user_id: session.user.id, name, email: session.user.email })
    .select("id, status")
    .single();

  if (error) {
    // Duplicate just means another tab/click already created it — treat as
    // success and move on rather than surfacing an error.
    if (error.message && error.message.includes("duplicate")) {
      const { data: raceRow } = await affiliatesClient
        .from("affiliates")
        .select("id, status")
        .eq("user_id", session.user.id)
        .maybeSingle();
      return { affiliate: raceRow, error: null };
    }
    return { affiliate: null, error: error.message };
  }

  return { affiliate: inserted, error: null };
}

function formatInr(amount) {
  return "₹" + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
