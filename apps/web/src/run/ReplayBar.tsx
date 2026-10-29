import { useEffect, useRef } from "react";
import { Button } from "../design";
import { formatElapsed } from "../format";
import type { RunEvent } from "./events";
import { describeEvent, elapsedAt, keyCommand, SPEED_LABELS, SPEEDS } from "./playhead";
import type { Replay } from "./useReplay";

const Icon = ({ d, fill = false }: { d: string; fill?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PLAY = "M5 3.2v9.6L12.6 8z";
const PAUSE = "M5.2 3.5v9M10.8 3.5v9";
const BACK = "M10 3.5 5.5 8l4.5 4.5M3.5 3v10";
const FORWARD = "M6 3.5 10.5 8 6 12.5M12.5 3v10";

// What takes a run's replay in hand: play and pause, a step either way, the speed and a scrubber
// over the run's events. It sits at the foot of the page and stays in view while the timeline is
// read. Space and the arrow keys work from anywhere on the page.
export function ReplayBar({ events, replay }: { events: readonly RunEvent[]; replay: Replay }) {
  const { position, playing, speed } = replay;
  const total = events.length;
  const current = events[position - 1];
  const playButton = useRef<HTMLButtonElement>(null);

  // Opening the replay puts the keyboard on Play, so space is the first thing that works.
  useEffect(() => playButton.current?.focus({ preventScroll: true }), []);

  const { toggle, step, seek } = replay;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = keyCommand(
        event.key,
        {
          tag: target?.tagName ?? "BODY",
          type: target instanceof HTMLInputElement ? target.type : null,
        },
        { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey },
      );
      if (!command) return;
      event.preventDefault();
      if (command === "toggle") toggle();
      else if (command === "back") step(-1);
      else if (command === "forward") step(1);
      else if (command === "first") seek(1);
      else seek(total);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step, seek, total]);

  const what = current ? describeEvent(current) : "";
  const time = formatElapsed(elapsedAt(events, position));
  return (
    <section className="replay" aria-label="Replay">
      <div className="replay-controls">
        <button
          ref={playButton}
          type="button"
          className="replay-play"
          onClick={replay.toggle}
          aria-keyshortcuts="Space"
        >
          <Icon d={playing ? PAUSE : PLAY} fill={!playing} />
          {playing ? "Pause" : position >= total ? "Play again" : "Play"}
        </button>
        <button
          type="button"
          className="icon-button replay-step"
          onClick={() => replay.step(-1)}
          disabled={position <= 1}
          aria-label="Previous event"
          aria-keyshortcuts="ArrowLeft"
        >
          <Icon d={BACK} />
        </button>
        <button
          type="button"
          className="icon-button replay-step"
          onClick={() => replay.step(1)}
          disabled={position >= total}
          aria-label="Next event"
          aria-keyshortcuts="ArrowRight"
        >
          <Icon d={FORWARD} />
        </button>
        <input
          className="replay-scrubber"
          type="range"
          min={1}
          max={total}
          step={1}
          value={position}
          aria-label="Position in the run"
          aria-valuetext={`Event ${position} of ${total}, ${time} in: ${what}`}
          onChange={(e) => replay.seek(Number(e.target.value))}
        />
        <span className="replay-readout t-data">
          {position} of {total} · {time}
        </span>
        <fieldset className="replay-speeds">
          <legend className="visually-hidden">Speed</legend>
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              className="replay-speed"
              aria-pressed={speed === option}
              onClick={() => replay.setSpeed(option)}
            >
              {SPEED_LABELS[option]}
            </button>
          ))}
        </fieldset>
        <Button variant="secondary" small onClick={replay.exit}>
          Exit replay
        </Button>
      </div>
      <p className="replay-now" aria-live={playing ? "off" : "polite"}>
        {what}
      </p>
    </section>
  );
}
