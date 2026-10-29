import { Mark } from "./Mark";

// The mark and the name, set in Newsreader. The app's top bar links it home.
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Mark size={size} />
      <span className="wordmark-name">Chaperone</span>
    </span>
  );
}
