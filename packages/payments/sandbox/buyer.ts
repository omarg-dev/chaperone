import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The buyer's side of the sandbox, scripted in a headless browser: logging in on an approval link
// and pressing the button that approves it. Used to save the buyer's wallet once, and by the
// contract run for the one test that approves an order through its link. It stops at the redirect
// back to the return URL, so nothing has to be listening there.
//
// Playwright core and Chromium aren't dependencies of this package: they come from the machine
// (PLAYWRIGHT_CORE_PATH, CHROMIUM_PATH), with the cloud environment's locations as defaults.

export interface BuyerLogin {
  email: string;
  password: string;
}

// The buttons that approve, across the wallet setup page and the order approval page.
const APPROVE_BUTTON =
  /^(Save and Continue|Continue|Continue to Review Order|Agree and Continue|Complete Purchase)$/;
const WAIT_MS = 90_000;

// The few Playwright calls used here, since its types aren't installed.
interface Page {
  route(url: string, handler: (route: Route) => void): Promise<void>;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  locator(selector: string): Locator;
  getByRole(role: string, options: { name: RegExp }): Locator;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  url(): string;
}
interface Locator {
  first(): Locator;
  isVisible(): Promise<boolean>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
}
interface Route {
  request(): { url(): string };
  fulfill(response: { status: number; body: string }): Promise<void>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export function buyerLoginFromEnv(env: NodeJS.ProcessEnv = process.env): BuyerLogin {
  const missing = ["SANDBOX_BUYER_EMAIL", "SANDBOX_BUYER_PASSWORD"].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`The scripted buyer needs ${missing.join(", ")}. See .env.example.`);
  }
  return {
    email: env.SANDBOX_BUYER_EMAIL as string,
    password: env.SANDBOX_BUYER_PASSWORD as string,
  };
}

// Approves `approveUrl` as the buyer and returns the URL the platform sent them back to, whose
// query carries what the approval produced.
export async function approveAsBuyer(
  approveUrl: string,
  login: BuyerLogin,
  returnUrl: string,
): Promise<URL> {
  const require = createRequire(import.meta.url);
  const { chromium } = require(
    process.env.PLAYWRIGHT_CORE_PATH ?? "/opt/node-tools/node_modules/playwright-core",
  ) as { chromium: { launch(options: object): Promise<Browser> } };
  const proxy = process.env.HTTPS_PROXY;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    ...(proxy ? { proxy: { server: proxy } } : {}),
  });
  try {
    const page = await browser.newPage();
    let returned: string | null = null;
    await page.route(`${new URL(returnUrl).origin}/**`, (route) => {
      returned = route.request().url();
      void route.fulfill({ status: 200, body: "Approved" });
    });
    await page.goto(approveUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MS });

    const deadline = Date.now() + WAIT_MS;
    let loggedIn = false;
    while (!returned && Date.now() < deadline) {
      await page.waitForTimeout(2_000);
      if (returned) break;
      if (!loggedIn && (await visible(page.locator("#email")))) {
        await page.locator("#email").fill(login.email);
        // The email and password are on one page or two, depending on the platform's mood.
        if (await visible(page.locator("#btnNext"))) {
          await page.locator("#btnNext").click();
          await page.waitForTimeout(2_000);
        }
        await page.locator("#password").fill(login.password);
        await page.locator("#btnLogin").click();
        loggedIn = true;
        continue;
      }
      const approve = page.getByRole("button", { name: APPROVE_BUTTON }).first();
      if (await visible(approve)) await approve.click();
    }
    if (!returned) {
      const shot = join(tmpdir(), `buyer-approval-${Date.now()}.png`);
      await page.screenshot({ path: shot });
      const at = new URL(page.url());
      throw new Error(
        `The buyer's approval didn't finish; stuck at ${at.host}${at.pathname} (${shot})`,
      );
    }
    return new URL(returned);
  } finally {
    await browser.close();
  }
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}
