// Admin auth guard for admin/applications.html. Same pattern as the store's
// admin panel: invite-only (public signup disabled at the project level),
// email+password sign-in, checked against admin_users via RLS (a non-admin
// gets zero rows back, not an error — see "admin can read admin_users"
// policy, qual is_admin()).
//
// Returns the admin's user row on success, or redirects to login.html and
// resolves null.
async function requireAdmin() {
  const {
    data: { session },
  } = await affiliatesClient.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  const { data: adminRow } = await affiliatesClient
    .from("admin_users")
    .select("user_id, email")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!adminRow) {
    await affiliatesClient.auth.signOut();
    window.location.href = "login.html?denied=1";
    return null;
  }

  return adminRow;
}

async function adminSignOut() {
  await affiliatesClient.auth.signOut();
  window.location.href = "login.html";
}

document.addEventListener("click", (e) => {
  if (e.target.id === "adminSignOutBtn") adminSignOut();
});
