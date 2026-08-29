// screen-affiliate-application
//
// Called by the client (auth.html) right after a new affiliate application
// is inserted (ensureAffiliateApplication), while the "Confirming your
// email…" panel is showing. Runs the application through an LLM risk
// screen and writes the result back:
//   - risk "low"    -> auto-approves (status: pending -> approved)
//   - risk "medium"/"high", or screening failure -> stays "pending",
//     flagged for a human to review in the admin panel, with the model's
//     reasoning attached so the admin isn't starting from nothing.
// This is an assist, not a gate that can reject anyone — the model can
// only ever fast-track an approval or leave the existing manual-review
// path unchanged. Rejection is always an admin action.
//
// Auth: verify_jwt is on. The caller must be the affiliate themselves
// (their own session) — resolved via withSupabase({auth:"user"}), same
// pattern as admin-clean-product. The actual DB writes to status/
// ai_risk_label/etc. use a service-role client, because the affiliates
// table has a trigger (protect_affiliate_privileged_columns) that reverts
// those columns for any non-admin, non-service-role write — a signed-in
// affiliate's own session literally cannot self-approve, on purpose.
//
// LLM fallback chain: reuses the order already decided for this project
// (Mood Store — Build Journey, 2026-08-29 "Multiple LLM keys added" entry):
// DeepSeek -> Cohere -> NVIDIA -> NVIDIA_2. Only these four are wired with
// verified request/response formats. REQUESTY_API_KEY, AIONLABS_API_KEY,
// "HUGGING FACE", and OLLAMA are intentionally left out for now — that
// same entry flagged their exact API shapes as unconfirmed ("do not guess
// and ship silently-broken integrations"). Add them the same way once
// their formats are checked.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK");
const COHERE_KEY = Deno.env.get("COHERE");
const NVIDIA_KEY = Deno.env.get("NVIDIA");
const NVIDIA_2_KEY = Deno.env.get("NVIDIA_2");

interface ScreenResult {
  risk: "low" | "medium" | "high";
  reasoning: string;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (_req, ctx) => {
    const userId = ctx.userClaims?.sub ?? ctx.userClaims?.id ?? ctx.userClaims?.user_id;
    if (!userId) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Read via the user's own scoped client — RLS already lets an
    // affiliate read their own row, no service role needed for this part.
    const { data: affiliate, error: readErr } = await ctx.supabase
      .from("affiliates")
      .select("id, name, email, promotion_channel, application_note, status, ai_screened_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (readErr || !affiliate) {
      return Response.json({ error: "No application found for this account" }, { status: 404 });
    }

    // Idempotent: don't re-screen (and don't burn another LLM call) if this
    // application was already screened, e.g. a retried request.
    if (affiliate.ai_screened_at) {
      return Response.json({
        risk: affiliate.status === "approved" ? "low" : null,
        already_screened: true,
        status: affiliate.status,
      });
    }

    // Only ever screen pending applications — never touch an application an
    // admin already decided on manually.
    if (affiliate.status !== "pending") {
      return Response.json({ already_decided: true, status: affiliate.status });
    }

    const result = await screenApplication(affiliate);

    const update: Record<string, unknown> = {
      ai_risk_label: result.risk,
      ai_reasoning: result.reasoning,
      ai_screened_at: new Date().toISOString(),
    };
    if (result.risk === "low") {
      update.status = "approved";
      update.approved_at = new Date().toISOString();
    }

    const { error: writeErr } = await serviceClient
      .from("affiliates")
      // Belt-and-braces: only ever apply this to the row we just screened,
      // and only if it's still pending (in case an admin approved/rejected
      // it manually in the few seconds this call took).
      .update(update)
      .eq("id", affiliate.id)
      .eq("status", "pending");

    if (writeErr) {
      console.error("[screen-affiliate-application] write failed:", writeErr);
      return Response.json({ error: "Screened, but failed to save the result" }, { status: 500 });
    }

    return Response.json({
      risk: result.risk,
      reasoning: result.reasoning,
      status: result.risk === "low" ? "approved" : "pending",
    });
  }),
};

async function screenApplication(affiliate: {
  name: string;
  email: string;
  promotion_channel: string | null;
  application_note: string | null;
}): Promise<ScreenResult> {
  const providers: Array<() => Promise<ScreenResult>> = [
    () => callDeepSeek(affiliate),
    () => callCohere(affiliate),
    () => callNvidia(affiliate, "NVIDIA", NVIDIA_KEY),
    () => callNvidia(affiliate, "NVIDIA_2", NVIDIA_2_KEY),
  ];

  for (const call of providers) {
    try {
      const result = await call();
      if (result) return result;
    } catch (err) {
      console.error("[screen-affiliate-application] provider failed:", (err as Error).message);
      // fall through to the next provider in the chain
    }
  }

  // Every provider failed (or none configured). Fail safe: never
  // auto-approve on a screening failure — leave it pending with a clear
  // note so the admin knows the AI step didn't run, rather than silently
  // treating it as either risk level.
  return {
    risk: "medium",
    reasoning: "AI screening was unavailable for this application — needs manual review.",
  };
}

function buildPrompt(affiliate: {
  name: string;
  email: string;
  promotion_channel: string | null;
  application_note: string | null;
}) {
  return (
    "You are screening a new affiliate/creator-partner application for an " +
    "Indian women's fashion e-commerce store (Mood Store). Assess how " +
    "risky it would be to auto-approve this application versus routing it " +
    "for manual review. Consider: does the email look disposable/throwaway " +
    "or oddly formatted; does the stated promotion plan sound like a real, " +
    "specific plan (a named channel, platform, or audience) versus vague, " +
    "generic, spammy, or copy-pasted text; any signs of bot-like or bulk " +
    "sign-up behavior. Being unable to verify something is NOT itself a " +
    "reason to flag as high risk — only flag on genuine red flags. Most " +
    "ordinary applications from real people should be \"low\" risk.\n\n" +
    `Name: ${affiliate.name || "(none given)"}\n` +
    `Email: ${affiliate.email || "(none given)"}\n` +
    `Promotion channel: ${affiliate.promotion_channel || "(none given)"}\n` +
    `Application note: ${affiliate.application_note || "(none given)"}\n\n` +
    'Respond with ONLY a JSON object: {"risk": "low" | "medium" | "high", ' +
    '"reasoning": "<one short sentence, under 200 characters>"}.'
  );
}

function parseResult(text: string): ScreenResult {
  const parsed = JSON.parse(text);
  const risk = String(parsed.risk || "").toLowerCase();
  if (risk !== "low" && risk !== "medium" && risk !== "high") {
    throw new Error(`Invalid risk value: ${parsed.risk}`);
  }
  const reasoning = String(parsed.reasoning || "").slice(0, 300).trim();
  if (!reasoning) throw new Error("Empty reasoning");
  return { risk, reasoning };
}

async function callDeepSeek(affiliate: Parameters<typeof buildPrompt>[0]): Promise<ScreenResult> {
  if (!DEEPSEEK_KEY) throw new Error("DEEPSEEK not configured");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: buildPrompt(affiliate) }],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek returned no content");
  return parseResult(text);
}

async function callCohere(affiliate: Parameters<typeof buildPrompt>[0]): Promise<ScreenResult> {
  if (!COHERE_KEY) throw new Error("COHERE not configured");
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${COHERE_KEY}`,
    },
    body: JSON.stringify({
      model: "command-r",
      messages: [{ role: "user", content: buildPrompt(affiliate) + "\n\nRespond with JSON only, no other text." }],
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`Cohere HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string | undefined = data?.message?.content
    ?.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : ""))
    .join("");
  if (!text) throw new Error("Cohere returned no content");
  // Cohere doesn't have a strict JSON mode here — strip any stray fencing.
  const cleaned = text.trim().replace(/^```json\s*|\s*```$/g, "");
  return parseResult(cleaned);
}

async function callNvidia(
  affiliate: Parameters<typeof buildPrompt>[0],
  label: string,
  key: string | undefined,
): Promise<ScreenResult> {
  if (!key) throw new Error(`${label} not configured`);
  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: buildPrompt(affiliate) + "\n\nRespond with JSON only, no other text." }],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${label} returned no content`);
  const cleaned = text.trim().replace(/^```json\s*|\s*```$/g, "");
  return parseResult(cleaned);
}
