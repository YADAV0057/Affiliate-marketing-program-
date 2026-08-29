async function loadCatalogue() {
  // Adjust the nav link depending on whether a session already exists —
  // doesn't gate anything, purely cosmetic, so a failed check is harmless.
  try {
    const {
      data: { session },
    } = await affiliatesClient.auth.getSession();
    if (session) {
      const navLink = document.getElementById("authNavLink");
      navLink.textContent = "Dashboard";
      navLink.href = "dashboard.html";
    }
  } catch (e) {
    // Ignore — nav label just stays "Sign in".
  }

  let products;
  try {
    products = await getPublicCatalogue();
  } catch (e) {
    document.getElementById("catalogueList").innerHTML =
      '<p class="state-msg">Could not load the product catalog right now. Try refreshing.</p>';
    return;
  }

  if (!products.length) {
    document.getElementById("catalogueList").innerHTML =
      '<p class="state-msg">No products are live in the store yet.</p>';
    return;
  }

  document.getElementById("catalogueList").innerHTML = products
    .map((p) => {
      const price = "₹" + Number(p.price_inr || 0).toLocaleString("en-IN");
      return `
      <div class="product-card">
        <img class="product-thumb" src="${p.image_url || ""}" alt="" onerror="this.style.visibility='hidden'" />
        <div class="product-info">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <p class="product-price">${price}</p>
          <button class="btn small" style="width:100%" onclick="resolvePromoteDestination('${p.slug}')">Promote this product</button>
        </div>
      </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

loadCatalogue();
