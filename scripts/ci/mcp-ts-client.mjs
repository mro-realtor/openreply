// Independent client #1: official TypeScript MCP SDK over real HTTP.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";

const url = new URL(process.env.MCP_URL);
const open = async (token) => {
  const client = new Client({ name: "ci-ts-client", version: "1.0.0" });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
};
const text = (r) => r.content[0].text;

const readOnly = await open(process.env.READ_TOKEN);
const names = (await readOnly.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(names, ["get_account", "get_campaign", "list_accounts", "list_campaign_logs", "list_campaigns"]);
assert.match(text(await readOnly.callTool({ name: "list_accounts", arguments: {} })), /interop\.account/);
assert.ok(!text(await readOnly.callTool({ name: "list_accounts", arguments: {} })).includes("enc-ci-secret"));
await readOnly.close();

const drafter = await open(process.env.DRAFT_TOKEN);
assert.ok((await drafter.listTools()).tools.some((t) => t.name === "create_draft_campaign"));
const created = await drafter.callTool({
  name: "create_draft_campaign",
  arguments: { instagramUsername: "interop.account", name: "interop ts draft", keywords: ["CASA"], dmMessage: "Hola" },
});
assert.ok(!created.isError, text(created));
assert.equal(JSON.parse(text(created)).status, "draft");
const bad = await drafter.callTool({
  name: "create_draft_campaign",
  arguments: { instagramUsername: "interop.account", name: "x", dmMessage: "y", isActive: true },
});
assert.equal(bad.isError, true);
await drafter.close();

await assert.rejects(() => open(null), "connecting without a token must fail");
console.log("TS SDK client: all assertions passed");
