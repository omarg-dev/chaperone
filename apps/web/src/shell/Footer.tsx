import { Link } from "react-router";

export const REPO_URL = "https://github.com/omarg-dev/chaperone";
export const CONTACT = "contact@omarg.dev";

// The foot of every page: who made it and how to reach him, where the source and its licence are,
// and what money this is. Words only: no company's logo appears here or anywhere in the product.
export function Footer() {
  return (
    <footer className="site-foot">
      <div className="site-foot-inner">
        <p className="site-foot-made">
          Made by Omar Ghazal
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
        <nav aria-label="About Chaperone">
          <ul className="site-foot-links">
            <li>
              <Link to="/docs">Docs</Link>
            </li>
            <li>
              <a href={REPO_URL}>Source on GitHub</a>
            </li>
            <li>
              <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT licence</a>
            </li>
          </ul>
        </nav>
        <p className="site-foot-money">Built on PayPal's sandbox. Sandbox money only.</p>
      </div>
    </footer>
  );
}
