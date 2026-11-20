import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedRobloxProxyTarget } from "../src/lib/roblox-wisp-sockets.ts";
test("Roblox Wisp accepts HTTPS destinations on Roblox domains", () => {
  for (const host of ["roblox.com","www.roblox.com","users.roblox.com","clientsettingscdn.roblox.com","setup.rbxcdn.com","apis.roblox.com","subdomain.robloxlabs.com"]) assert.equal(isAllowedRobloxProxyTarget(host,443),true,host);
});
test("Roblox Wisp blocks unrelated hosts, IP literals and non-HTTPS ports", () => {
  for (const [host,port] of [["example.com",443],["roblox.com.attacker.example",443],["notroblox.com",443],["127.0.0.1",443],["localhost",443],["roblox.com",80],["roblox.com",8080]]) assert.equal(isAllowedRobloxProxyTarget(host,port),false,`${host}:${port}`);
});
