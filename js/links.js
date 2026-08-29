let currentAffiliate = null;
let currentStore = null;

async function loadProducts() {
  currentAffiliate = await requireAffiliateForLinks();
  if (!currentAffiliate) return;

  const isPending = currentAffiliate.status === "pending";
  const pendingNotice = document.getElementById("pendingNotice");
  if (pendingNotice) pendingNotice.hidden = !isPending;

  try {
    currentStore = await getPublicStore();
  } catch (e) {
    document.getElementById("productList").innerHTML =
      '<p class="state-msg">Could not load store details right now. Try refreshing.</p>';
    return;
  }

  const [{ data: products, error: prodErr }, { data: existingLinks, error: linkErr }] = await Promise.all([
    storeClient
      .from("store_products")
      .select("slug, name, price_inr, image_url")
      .eq("is_active", true)
      .order("name"),
    affiliatesClient
      .from("affiliate_product_links")
      .select("product_slug, ref_code")
      .eq("affiliate_id", currentAffiliate.id),
  ]);

  if (prodErr || !products) {
    document.getElementById("productList").innerHTML =
      '<p class="state-msg">Could not load the product catalog. Try refreshing.</p>';
    return;
  }

  const linkBySlug = {};
  if (!linkErr && existingLinks) {
    for (const l of existingLinks) linkBySlug[l.product_slug] = l.ref_code;
  }

  if (!products.length) {
    document.getElementById("productList").innerHTML =
      '<p class="state-msg">No products are live in the store yet.</p>';
    return;
  }

  document.getElementById("productList").innerHTML = products
    .map((p) => {
      const existingRef = linkBySlug[p.slug];
      const price = "₹" + Number(p.price_inr || 0).toLocaleString("en-IN");
      const btnDisabled = isPending || existingRef;
      const btnLabel = isPending ? "Pending approval" : existingRef ? "Link ready" : "Generate link";
      const btnOnclick = isPending ? "" : `onclick="handleGenerate('${p.slug}')"`;
      return `
      <div class="product-card" id="card-${p.slug}">
        <img class="product-thumb" src="${p.image_url || ""}" alt="" onerror="this.style.visibility='hidden'" />
        <div class="product-info">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <p class="product-price">${price}</p>
          <button
            class="btn small"
            id="btn-${p.slug}"
            ${btnOnclick}
            ${btnDisabled ? "disabled" : ""}
          >${btnLabel}</button>
          <div class="link-box ${existingRef ? "visible" : ""}" id="link-${p.slug}">${
            existingRef ? buildLink(p.slug, existingRef) : ""
          }</div>
        </div>
      </div>`;
    })
    .join("");

  // If they arrived here via "Promote this product" on the public
  // catalogue, scroll to and highlight that exact card instead of leaving
  // them to find it in the grid themselves.
  const intentSlug = consumePromoteIntent();
  if (intentSlug) {
    const card = document.getElementById("card-" + intentSlug);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("product-card-highlight");
      setTimeout(() => card.classList.remove("product-card-highlight"), 3000);
    }
  }
}

function buildLink(slug, refCode) {
  const base = currentStore.site_url.replace(/\/$/, "");
  return `${base}/product/${slug}.html?ref=${refCode}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

async function handleGenerate(slug) {
  const btn = document.getElementById("btn-" + slug);
  btn.disabled = true;
  btn.textContent = "Generating…";

  const { data: inserted, error } = await affiliatesClient
    .from("affiliate_product_links")
    .insert({
      affiliate_id: currentAffiliate.id,
      store_id: currentStore.id,
      product_slug: slug,
    })
    .select("ref_code")
    .maybeSingle();

  let refCode = inserted?.ref_code;

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await affiliatesClient
        .from("affiliate_product_links")
        .select("ref_code")
        .eq("affiliate_id", currentAffiliate.id)
        .eq("store_id", currentStore.id)
        .eq("product_slug", slug)
        .maybeSingle();
      refCode = existing?.ref_code;
    } else {
      btn.disabled = false;
      btn.textContent = "Generate link";
      alert("Could not generate a link right now. Try again.");
      return;
    }
  }

  const linkBox = document.getElementById("link-" + slug);
  linkBox.textContent = buildLink(slug, refCode);
  linkBox.classList.add("visible");
  btn.textContent = "Link ready";
}

loadProducts();
