import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";

test("private workspace: keyboard capture, safe preview, edit, search, chat and mobile navigation", async ({ page }, info) => {
  if (!process.env.BROWSER_TEST_URL || !process.env.BROWSER_TEST_PASSWORD) throw new Error("Use npm run test:release to provision an isolated installation.");
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const external: string[] = [];
  page.on("request", r => { if (r.url().includes("untrusted.invalid")) external.push(r.url()); });
  await page.goto("/knowledge");
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill(process.env.BROWSER_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
  if (info.project.name === "mobile") await page.getByRole("button", { name: "Folders", exact: true }).click();
  await page.getByRole("button", { name: "Add to root", exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Add subfolder", exact: true }).click();
  await page.getByLabel("Folder name").fill("Java " + info.project.name);
  await page.getByRole("button", { name: "Create folder", exact: true }).click();
  await page.getByRole("button", { name: "Add to java-" + info.project.name, exact: true }).filter({ visible: true }).click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Java syntax " + info.project.name);
  const body = '# Java syntax\n\nSynthetic release example. A class groups fields and methods.\n\n```java\nclass Example { String value = "' + 'long'.repeat(100) + '"; }\n```\n\n![remote](https://untrusted.invalid/pixel)\n\n<script>window.injected = true</script>\n\n[unsafe](javascript:alert(1))';
  await page.getByLabel("Markdown", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Preview Markdown & code" }).click();
  await expect(page.getByRole("link", { name: "[Image: remote]", exact: true })).toBeVisible();
  expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(external).toEqual([]);
  await page.getByRole("button", { name: "No, save as written" }).click();
  await page.getByRole("link", { name: "Open saved note" }).click();
  await expect(page.getByRole("heading", { name: "Java syntax " + info.project.name, exact: true })).toBeVisible();
  const noteUrl = page.url();
  await page.getByRole("button", { name: "Edit / Improve", exact: true }).click();
  await page.getByRole("button", { name: "Yes, improve with AI", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Configure|OpenRouter|model/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue(body);
  await page.getByRole("textbox", { name: "Markdown", exact: true }).fill(body + "\n\nRevised source keyword: revisionneedle.");
  await page.getByRole("button", { name: "No, save as written" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Revised source keyword: revisionneedle.", { exact: true }).first()).toBeVisible();
  if (info.project.name === "desktop" && process.env.RELEASE_SCREENSHOTS === "1") {
    await expect(page.getByLabel("Chat message")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Java desktop", exact: true }).filter({ visible: true })).toBeVisible();
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({ path: "docs/screenshots/workspace.png" });
  }
  for (const route of ["/search?q=revisionneedle", "/graph", "/review", "/chat"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(result.violations.filter(v => ["critical", "serious"].includes(v.impact || "")).map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, problem: n.failureSummary })) })), route).toEqual([]);
  }
  await page.getByLabel("Chat mode").selectOption("save");
  await page.getByLabel("Chat message").fill("Synthetic chat note saved without a model.");
  await page.getByLabel("Chat message").press("Enter");
  await expect(page.getByText(/Saved.*v|Saved.*version|Saved to/i).first()).toBeVisible({ timeout: 20_000 });
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto(noteUrl);
  await page.getByRole("button", { name: "Edit / Improve", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit / Improve", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

