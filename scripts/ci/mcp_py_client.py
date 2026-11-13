"""Independent client #2: official Python MCP SDK over real HTTP."""
import asyncio, json, os, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ["MCP_URL"]

async def session(token):
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as s:
            await s.initialize()
            tools = sorted(t.name for t in (await s.list_tools()).tools)
            accounts = await s.call_tool("list_accounts", {})
            created = None
            if "create_draft_campaign" in tools:
                created = await s.call_tool("create_draft_campaign", {
                    "instagramUsername": "interop.account", "name": "interop py draft",
                    "keywords": ["CASA"], "dmMessage": "Hola"})
            return tools, accounts.content[0].text, created

async def main():
    tools, accounts, _ = await session(os.environ["READ_TOKEN"])
    assert "create_draft_campaign" not in tools, tools
    assert "interop.account" in accounts
    tools, _, created = await session(os.environ["DRAFT_TOKEN"])
    assert "create_draft_campaign" in tools
    assert json.loads(created.content[0].text)["status"] == "draft"
    print("Python SDK client: all assertions passed")

asyncio.run(main())
