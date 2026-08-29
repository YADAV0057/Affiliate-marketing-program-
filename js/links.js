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
            existingRef ? renderLinkBox(p.slug, buildLink(p.slug, existingRef)) : ""
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

// Renders the contents of a .link-box: the URL itself plus a small copy
// button. Kept as one helper so the initial grid render (loadProducts)
// and a freshly-generated link (handleGenerate) always produce identical
// markup.
function renderLinkBox(slug, url) {
  return `
    <span class="link-text">${escapeHtml(url)}</span>
    <button
      type="button"
      class="copy-btn"
      onclick="copyLink('${slug}', this)"
      aria-label="Copy link"
      title="Copy link"
    >
      <svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="8" y="8" width="12" height="12" rx="2"/>
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
      </svg>
      <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 13l4 4L19 7"/>
      </svg>
    </button>`;
}

// Copies a product's tracked link in one tap. Tries the modern Clipboard
// API first; falls back to a hidden-textarea + execCommand for contexts
// where that API isn't available (older in-app browsers etc.) so the
// button still works everywhere. `btn` is passed in directly from the
// inline onclick so this never has to re-query the DOM for it.
async function copyLink(slug, btn) {
  const linkBox = document.getElementById("link-" + slug);
  const text = linkBox.querySelector(".link-text")?.textContent || "";
  if (!text) return;

  const ok = await writeToClipboard(text);
  if (!ok) {
    alert("Could not copy the link — please select and copy it manually.");
    return;
  }

  btn.classList.add("copied");
  clearTimeout(btn._copyResetTimer);
  btn._copyResetTimer = setTimeout(() => btn.classList.remove("copied"), 1600);
}

async function writeToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // fall through to the legacy method below
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
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
  linkBox.innerHTML = renderLinkBox(slug, buildLink(slug, refCode));
  linkBox.classList.add("visible");
  btn.textContent = "Link ready";
}

loadProducts();
