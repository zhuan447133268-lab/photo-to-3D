// ZCode in-app driver: uses the browser that belongs to the ZCode desktop session.
//
// This backend exists because the browser here is a bridge owned by the app, not a process you can
// spawn. Consequences worth knowing:
//   - It only works from inside the app's JS runtime (the node_repl tool), never from `node script.mjs`.
//   - Every call starts a fresh kernel, so re-run setupBrowserRuntime() each time.
//   - Imported modules do not see the caller's globalThis.agent, so the agent must be passed in.
//
// Bootstrap, then:
//   await setupBrowserRuntime({ globals: globalThis });
//   const { openPage } = await import(".../drivers/index.mjs");
//   const { tab } = await openPage(url, { driver: "zcode", agent: globalThis.agent });
export async function openPage(url, opts = {}) {
  const agent = resolveAgent(opts.agent);

  // browsers.open(url, { reuseTab }) is the shortest path that works on a cold session: it picks or
  // creates the tab and hands back a Tab directly. tabs.list() alone returns [] there.
  if (typeof agent.browsers.open === "function") {
    const tab = await agent.browsers.open(url, { reuseTab: true });
    const browser = await agent.browsers.getForUrl(url);
    return { browser, tab, driver: "zcode" };
  }

  const browser = await agent.browsers.getForUrl(url);
  const tabs = await browser.tabs.list();
  const active = tabs.find((t) => t.active) ?? tabs[0];
  const tab = active ? await browser.tabs.get(active.id) : await browser.tabs.new();
  return { browser, tab, driver: "zcode" };
}

export function resolveAgent(explicit) {
  const agent = explicit ?? globalThis.agent;
  if (agent?.browsers) return agent;

  throw new Error(
    "ZCode driver: no agent with .browsers.\n"
    + "Run setupBrowserRuntime({ globals: globalThis }) inside the app's JS runtime first and pass "
    + "globalThis.agent, or use the portable backend: --driver playwright.",
  );
}