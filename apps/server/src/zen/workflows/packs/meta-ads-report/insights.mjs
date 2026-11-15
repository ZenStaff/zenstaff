// Zen Staff pack helper: last week's ad insights through the credential proxy
// ($ZEN_SECRET_META_ADS_URL). Usage: node insights.mjs act_123
const account = process.argv[2];
const base = process.env.ZEN_SECRET_META_ADS_URL;
if (!/^act_\d+$/.test(account ?? "")) {
  console.log("ERROR: the ad account ID looks like act_1234567890.");
  process.exit(1);
}
if (!base) {
  console.log("ERROR: the Meta connection is not prepared. Start this task from Zen Staff.");
  process.exit(1);
}
const fields = "campaign_name,ad_name,spend,impressions,clicks,ctr,actions,cost_per_action_type";
const url = `${base}/v21.0/${account}/insights?level=ad&date_preset=last_7d&fields=${fields}&limit=200`;
const response = await fetch(url);
const body = await response.text();
if (!response.ok) {
  console.log(`ERROR: Meta answered ${response.status}: ${body.slice(0, 300)}`);
  process.exit(1);
}
console.log(body);
