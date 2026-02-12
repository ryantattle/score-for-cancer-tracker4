// api/score-for-cancer-total.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const targetUrl = "https://fundraisemyway.cancer.ca/campaigns/scoreforcancer";

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
      },
    });

    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: `Upstream returned ${upstream.status}`,
      });
    }

    const html = await upstream.text();

    const moneyRegex = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
    const matches = [...html.matchAll(moneyRegex)];

    const parseMoney = (s) => {
      const n = Number(String(s).replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    // Build candidate list with context
    const candidates = matches
      .map((m) => {
        const raw = m[0];
        const index = m.index ?? -1;
        const value = parseMoney(raw);
        if (value == null) return null;

        const start = Math.max(0, index - 140);
        const end = Math.min(html.length, index + raw.length + 140);
        const context = html.slice(start, end).toLowerCase();

        return { raw, value, index, context };
      })
      .filter(Boolean);

    // Score candidates by context relevance
    const scoreCandidate = (c) => {
      let score = 0;

      // Strong positive keywords
      if (/\braised\b/.test(c.context)) score += 8;
      if (/\bdonated?\b/.test(c.context)) score += 6;
      if (/\btotal\b/.test(c.context)) score += 4;
      if (/\bgoal\b/.test(c.context)) score += 2;
      if (/\bprogress\b/.test(c.context)) score += 2;
      if (/\bcampaign\b/.test(c.context)) score += 2;

      // Penalize tiny values heavily (avoids $1, $5 etc.)
      if (c.value < 100) score -= 12;
      else if (c.value < 1000) score -= 4;

      // Reward realistic fundraiser totals
      if (c.value >= 10000) score += 5;
      if (c.value >= 50000) score += 3;

      return score;
    };

    let picked = null;

    if (candidates.length > 0) {
      const ranked = candidates
        .map((c) => ({ ...c, score: scoreCandidate(c) }))
        .sort((a, b) => {
          // score first, then value
          if (b.score !== a.score) return b.score - a.score;
          return b.value - a.value;
        });

      picked = ranked[0];
    }

    // Fallback 1: JSON-like keys sometimes embedded
    if (!picked || !picked.value || picked.value < 100) {
      const jsonishPatterns = [
        /"amountRaised"\s*:\s*"?([\d.,]+)"?/i,
        /"totalRaised"\s*:\s*"?([\d.,]+)"?/i,
        /"raisedAmount"\s*:\s*"?([\d.,]+)"?/i,
        /"raised"\s*:\s*"?([\d.,]+)"?/i,
      ];

      for (const p of jsonishPatterns) {
        const m = html.match(p);
        if (m?.[1]) {
          const v = Number(m[1].replace(/[^\d.]/g, ""));
          if (Number.isFinite(v) && v >= 100) {
            picked = { raw: `$${v.toLocaleString("en-CA")}`, value: v, score: 999 };
            break;
          }
        }
      }
    }

    // Fallback 2: choose largest realistic amount
    if (!picked || !picked.value || picked.value < 100) {
      const realistic = candidates
        .filter((c) => c.value >= 1000)
        .sort((a, b) => b.value - a.value);

      if (realistic.length) picked = realistic[0];
    }

    if (!picked || !picked.value || picked.value < 100) {
      return res.status(200).json({
        ok: false,
        error: "Could not reliably locate campaign raised amount",
        source: targetUrl,
        fetchedAt: new Date().toISOString(),
        debugCount: candidates.length,
      });
    }

    const amount = Math.round(picked.value);

    return res.status(200).json({
      ok: true,
      campaign: "Score For Cancer",
      amount,
      formatted: `$${amount.toLocaleString("en-CA")}`,
      source: targetUrl,
      fetchedAt: new Date().toISOString(),
      debug: {
        matchedRaw: picked.raw,
        score: picked.score ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unexpected server error",
    });
  }
}
