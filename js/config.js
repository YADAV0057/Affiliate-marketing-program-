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

// persistSession/autoRefreshToken/detectSessionInUrl are already Supabase's
// defaults — stated explicitly here so it's not implicit/easy to lose in a
// future edit. This is what makes a signed-in affiliate stay signed in on
// this browser (session stored in localStorage, access token silently
// refreshed in the background) without ever re-entering the code, until
// they explicitly sign out, delete their account, or clear their
// browser's site data. No password is needed for this — that's a property
// of session storage, not of how the person originally signed in.
//
// flowType: 'pkce' — needed for Google OAuth's code exchange
// (exchangeCodeForSession in auth.html). The email OTP path doesn't touch
// this at all — verifyOtp() establishes the session directly from the
// typed code, no redirect/exchange involved.
const AUTH_CLIENT_OPTIONS = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storage: window.localStorage,
  },
};

const affiliatesClient = window.supabase.createClient(
  AFFILIATES_SUPABASE_URL,
  AFFILIATES_SUPABASE_ANON_KEY,
  AUTH_CLIENT_OPTIONS,
);
const storeClient = window.supabase.createClient(
  STORE_SUPABASE_URL,
  STORE_SUPABASE_ANON_KEY,
  AUTH_CLIENT_OPTIONS,
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
      "Application not finished",
      "You're signed in, but your partner application was never completed on this account.",
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
      "Application not finished",
      "You're signed in, but your partner application was never completed on this account.",
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
    ? '<a href="auth.html" class="btn small" style="margin-right:8px">Finish application</a>'
    : "";
  banner.innerHTML = `<strong>${title}</strong><p>${body}</p><div class="status-banner-actions">${applyLink}<button class="btn secondary small" id="signOutBtn">Sign out</button><button class="btn secondary small" id="deleteAccountBtn" style="color:#b3413a">Delete account</button></div>`;
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
  if (e.target.id === "deleteAccountBtn") handleDeleteAccountClick();
});

// ---------- Phase 4e: Delete Account ----------
// Server-side rules (delete-account edge function, moodstore-affiliates):
// hard-deletes the auth.users row; anonymizes name/email/payout details on
// the affiliates row but keeps referral_code/status and all
// affiliate_conversions/affiliate_payouts history intact (may be needed
// for Section 194H TDS filing) — never touched by the client, the edge
// function decides what's kept. The typed "DELETE" confirmation is
// enforced server-side too, not just here; this prompt is just the UX.
async function handleDeleteAccountClick() {
  const typed = window.prompt(
    "This permanently deletes your sign-in and removes your name/email from " +
      "our records. Your sales and payout history is kept for tax records, " +
      "but is no longer tied to you.\n\nType DELETE to confirm.",
  );
  if (typed === null) return; // cancelled
  if (typed.trim().toUpperCase() !== "DELETE") {
    alert('Account not deleted — you need to type "DELETE" exactly.');
    return;
  }

  try {
    const { data, error } = await affiliatesClient.functions.invoke(
      "delete-account",
      { body: { confirmation: typed.trim() } },
    );
    if (error) {
      alert("Couldn't delete your account: " + (error.message || "please try again."));
      return;
    }
    if (data && data.error) {
      alert(data.error);
      return;
    }
    await affiliatesClient.auth.signOut();
    window.location.href = "index.html?accountDeleted=1";
  } catch (err) {
    alert("Couldn't delete your account: " + (err.message || "please try again."));
  }
}

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
    window.location.href = "auth.html";
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

// ---------- Unified auth (auth.html) ----------
// Redesigned 2026-08-30: one page handles both new and returning partners.
// A person only ever proves their email/Google identity first; whether
// they're new is discovered *after* that, by checking for an existing
// affiliates row — never assumed up front. This replaces the old
// ensureAffiliateApplication() helper, which used to create the row
// immediately (with placeholder values) as part of verifying. Splitting
// "check" from "create" is what lets the profile questions move to a real
// follow-up step instead of sitting in front of the sign-in form.

// Looks up whether the signed-in user already has an affiliate
// application. Returns { affiliate, error }. affiliate is null (not an
// error) when the person is verified but has never applied before —
// that's the normal "new partner" case, not a failure.
async function getExistingAffiliate() {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();
  if (!session) return { affiliate: null, error: "no_session" };

  const { data, error } = await affiliatesClient
    .from("affiliates")
    .select("id, status")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) return { affiliate: null, error: error.message };
  return { affiliate: data || null, error: null };
}

// Creates the affiliate application row for the current session. Called
// from auth.html's post-verification profile step, once — never from the
// sign-in step itself. name falls back to Google profile data (when the
// person verified via Google) or the email's local part, so the field
// can be left blank without producing an unusable blank record.
async function createAffiliateApplication(name, promotion_channel, application_note) {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();
  if (!session) return { affiliate: null, error: "no_session" };

  const resolvedName =
    (name || "").trim() ||
    session.user.user_metadata?.full_name ||
    session.user.user_metadata?.name ||
    (session.user.email || "").split("@")[0];

  const { data: inserted, error } = await affiliatesClient
    .from("affiliates")
    .insert({
      user_id: session.user.id,
      name: resolvedName,
      email: session.user.email,
      promotion_channel: promotion_channel || null,
      application_note: application_note || null,
    })
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

// Builds the emailRedirectTo URL for Google OAuth: back to auth.html on
// this same deployment, carrying the promote-intent slug (if any) as a
// query param so it survives the redirect round-trip even if
// sessionStorage doesn't (e.g. a browser that partitions storage across
// the OAuth hop).
function buildAuthRedirectUrl() {
  const url = new URL("auth.html", window.location.origin + window.location.pathname.replace(/[^/]+$/, ""));
  const intentSlug = sessionStorage.getItem("promoteIntentSlug");
  if (intentSlug) url.searchParams.set("promote", intentSlug);
  return url.toString();
}

// sessionStorage doesn't survive the OAuth hop when Google's redirect
// lands in a different tab/storage context. As a fallback, the intended
// product slug is also carried as a ?promote= query param on the redirect
// URL itself; this restores it into sessionStorage on landing.
function restorePromoteIntentFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("promote");
  if (slug && !sessionStorage.getItem("promoteIntentSlug")) {
    sessionStorage.setItem("promoteIntentSlug", slug);
  }
}

// ---------- Phase 6: AI application screening ----------
// Fires the screen-affiliate-application edge function for a just-created
// application and waits for the result, so the very next redirect decision
// (postAuthRedirect) already reflects an auto-approval if one happened,
// instead of the affiliate seeing "pending" for a moment and then having
// to reload. Never throws — a screening failure just means the
// application stays in the normal manual-review queue, same as if this
// call didn't exist.
async function screenNewApplication() {
  try {
    const { data, error } = await affiliatesClient.functions.invoke(
      "screen-affiliate-application",
      { body: {} },
    );
    if (error) {
      console.error("Application screening failed:", error);
      return null;
    }
    return data;
  } catch (err) {
    console.error("Application screening failed:", err);
    return null;
  }
}

function formatInr(amount) {
  return "₹" + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
