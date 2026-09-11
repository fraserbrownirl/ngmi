// NGMI keeper cron — calls the tote keeper endpoint on an hourly trigger.
// The tote does the real work (settle due pots, reprint board snapshots);
// this worker is only the clock. CRON_SECRET is a secret binding and must
// equal the Vercel `CRON_SECRET` env on ngmi-stage and the GitHub Actions
// secret of the same name. Never commit the value.
const TOTE = "https://ngmi.markets/api/keeper/tick";

async function tick(env) {
  const res = await fetch(TOTE, {
    headers: { authorization: "Bearer " + env.CRON_SECRET },
  });
  const body = await res.text();
  console.log("keeper tick -> " + res.status + " " + body.slice(0, 500));
  return new Response(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
  // Manual tick: bearer header, or ?key=<CRON_SECRET> for a browser.
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization") || "";
    const keyed = url.searchParams.get("key") === env.CRON_SECRET;
    if (auth !== "Bearer " + env.CRON_SECRET && !keyed) {
      return new Response("unauthorized", { status: 401 });
    }
    return tick(env);
  },
};
