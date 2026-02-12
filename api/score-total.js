// api/score-for-cancer-total.js
// Vercel serverless function (Node.js 18+)

export default async function handler(req, res) {
  // Optional: allow your Framer domain only (replace with your real domain)
  // res.setHeader("Access-Control-Allow-Origin", "https://yourframerdomain.com");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const targetUrl = "https://fundraisemyway.cancer.ca/campaigns/scoreforcancer";

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // Pretend to be a normal browser
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Upstream returned ${response.status}`,
      });
    }

    const html = await response.text();

    // 1) Try broad regex for currency-like totals
    //    e.g. "$186,000" or "$186,000.00"
    const currencyMatches = [
      ...html.matchAll(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g),
    ].map((m) => m[0]);

    // Helper: parse "$186,000.00" -> 186000
    const toNumber = (s) =>
      Number((s || "").replace(/[^\d.]/g, "")) || null;

    // Heuristic: pick largest currency on page (often campaign total)
    let pickedRaw = null;
    let pickedValue = null;

    if (currencyMatches.length > 0) {
      const parsed = currencyMatches
        .map((raw) => ({ raw, value: toNumber(raw) }))
        .filter((x) => x.value !== null);

      parsed.sort((a, b) => b.value - a.value);
      pickedRaw = parsed[0]?.raw ?? null;
      pickedValue = parsed[0]?.value ?? null;
    }

    // 2) If regex fails, try some common JSON/attribute patterns
    //    (kept generic in case platform changes markup)
    if (!pickedValue) {
      const altPatterns = [
        /"total_raised"\s*:\s*"?([\d.,]+)"?/i,
        /"raised"\s*:\s*"?([\d.,]+)"?/i,
        /data-total-raised\s*=\s*"([\d.,]+)"/i,
      ];

      for (const p of altPatterns) {
        const m = html.match(p);
        if (m?.[1]) {
          const v = Number(m[1].replace(/[^\d.]/g, ""));
          if (Number.isFinite(v) && v > 0) {
            pickedValue = v;
            pickedRaw = `$${v.toLocaleString("en-CA")}`;
            break;
          }
        }
      }
    }

    if (!pickedValue) {
      return res.status(200).json({
        ok: false,
        error: "Could not locate raised amount in page markup",
        source: targetUrl,
        fetchedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      ok: true,
      campaign: "Score For Cancer",
      amount: pickedValue, // number: 186000
      formatted: `$${pickedValue.toLocaleString("en-CA")}`, // "$186,000"
      source: targetUrl,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unexpected server error",
    });
  }
}
