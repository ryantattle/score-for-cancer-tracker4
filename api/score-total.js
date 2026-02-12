import chromium from "@sparticuz/chromium";
import playwright from "playwright-core";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const targetUrl = "https://fundraisemyway.cancer.ca/campaigns/scoreforcancer";
  let browser;

  try {
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });

    const page = await browser.newPage({
      locale: "en-CA",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);

    const visibleText = await page.evaluate(() => document.body?.innerText || "");

    const moneyMatches = [...visibleText.matchAll(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g)]
      .map(m => m[0]);

    const toNum = (s) => Number(String(s).replace(/[^\d.]/g, ""));
    const candidates = moneyMatches
      .map(raw => ({ raw, value: toNum(raw) }))
      .filter(x => Number.isFinite(x.value) && x.value >= 1000)
      .sort((a, b) => b.value - a.value);

    if (!candidates.length) {
      return res.status(200).json({
        ok: false,
        error: "No realistic currency values found after JS render",
        source: targetUrl,
        fetchedAt: new Date().toISOString()
      });
    }

    const amount = Math.round(candidates[0].value);

    return res.status(200).json({
      ok: true,
      campaign: "Score For Cancer",
      amount,
      formatted: `$${amount.toLocaleString("en-CA")}`,
      source: targetUrl,
      fetchedAt: new Date().toISOString(),
      debug: { topCandidates: candidates.slice(0, 5) }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unexpected server error"
    });
  } finally {
    if (browser) await browser.close();
  }
}
