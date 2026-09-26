import { useRef, useState } from "react";
import { BookOpen, ChevronDown, CircleHelp, Keyboard, List, Volume2 } from "lucide-react";
import { Modal } from "./app";
import { Menu } from "./menu";
import "./help.css";

type HelpTopic = "play" | "shortcuts" | "sounds";

const TITLES: Record<HelpTopic, string> = {
  play: "How to play",
  shortcuts: "Keyboard shortcuts",
  sounds: "Sounds",
};

export function HelpMenu({ onFormats }: { onFormats: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<{
    topic: HelpTopic;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const open = (topic: HelpTopic) =>
    setPanel({ topic, returnFocus: container.current?.querySelector("summary") ?? null });
  return (
    <div className="help-menu-container" ref={container}>
      <Menu
        className="help-menu"
        triggerClassName="help-menu-trigger"
        label="Help"
        trigger={
          <>
            <CircleHelp size={19} aria-hidden="true" />
            <span>Help</span>
            <ChevronDown className="help-menu-chevron" size={13} aria-hidden="true" />
          </>
        }
      >
        <button type="button" onClick={() => open("play")}>
          <BookOpen size={17} aria-hidden="true" /> How to play
        </button>
        <button type="button" onClick={onFormats}>
          <List size={17} aria-hidden="true" /> Question formats
        </button>
        <button type="button" onClick={() => open("shortcuts")}>
          <Keyboard size={17} aria-hidden="true" /> Keyboard shortcuts
        </button>
        <button type="button" onClick={() => open("sounds")}>
          <Volume2 size={17} aria-hidden="true" /> Sounds
        </button>
      </Menu>
      {panel && (
        <Modal
          title={TITLES[panel.topic]}
          onClose={() => setPanel(null)}
          returnFocus={panel.returnFocus}
        >
          <div className="help-content">
            {panel.topic === "play" && <HowToPlay />}
            {panel.topic === "shortcuts" && <Shortcuts />}
            {panel.topic === "sounds" && <Sounds />}
          </div>
        </Modal>
      )}
    </div>
  );
}

function HowToPlay() {
  return (
    <div className="help-sections">
      <section>
        <h3>Join the game</h3>
        <p>
          Choose your name and ask to join. The owner approves players and spectators, then a
          moderator starts play. New players join in at the next question or format block.
        </p>
      </section>
      <section>
        <h3>Buzz, then type</h3>
        <p>
          Press Space or tap Buzz when you know the answer. If you win the buzz, type your answer
          and press Enter before time runs out. Everyone can see your guess as you type.
        </p>
        <p>A wrong answer usually locks you or your team out for the rest of that question.</p>
      </section>
      <section>
        <h3>Asked to be more specific?</h3>
        <p>
          Give the full answer in the new eight-second window. You get one clarification attempt; an
          incomplete answer has not scored yet.
        </p>
      </section>
      <section>
        <h3>Challenge a ruling</h3>
        <p>
          Press C or use Challenge while that question is still current. Play waits for a moderator
          to resolve it. Once the next question starts, the previous ruling is final.
        </p>
      </section>
      <section>
        <h3>Teams and sessions</h3>
        <p>
          In team mode, choose a team with an open spot. Points stay with the team that earned them.
          Some formats keep the same participants until the block ends.
        </p>
        <p>Scores and chat last for this session. When the last player leaves, the session ends.</p>
      </section>
    </div>
  );
}

function Shortcuts() {
  return (
    <>
      <p className="help-intro">
        Shortcuts work when you are not typing or using a menu, dialog or other control.
      </p>
      <dl className="help-shortcuts">
        <div>
          <dt>
            <kbd>Space</kbd>
          </dt>
          <dd>Buzz when you are eligible</dd>
        </div>
        <div>
          <dt>
            <kbd>C</kbd>
          </dt>
          <dd>Challenge the current ruling</dd>
        </div>
        <div>
          <dt>
            <kbd>T</kbd>
          </dt>
          <dd>Type in the lobby chat</dd>
        </div>
      </dl>
      <h3 className="help-subheading">Owner and moderators</h3>
      <dl className="help-shortcuts">
        <div>
          <dt>
            <kbd>P</kbd>
          </dt>
          <dd>Pause or resume</dd>
        </div>
        <div>
          <dt>
            <kbd>N</kbd>
          </dt>
          <dd>Go to the next question when available</dd>
        </div>
        <div>
          <dt>
            <kbd>S</kbd>
          </dt>
          <dd>Skip the current question immediately and reveal its answer</dd>
        </div>
      </dl>
    </>
  );
}

function Sounds() {
  return (
    <>
      <p className="help-intro">
        Sound starts off. Use the speaker in the header to turn it on for yourself. Your browser
        remembers your choice.
      </p>
      <dl className="help-sounds">
        <div>
          <dt>You win the buzz</dt>
          <dd>A bright, rising two-note pluck</dd>
        </div>
        <div>
          <dt>Someone else buzzes</dt>
          <dd>A low, rounded knock</dd>
        </div>
        <div>
          <dt>Correct answer</dt>
          <dd>A rising three-note chime</dd>
        </div>
        <div>
          <dt>Incorrect answer</dt>
          <dd>A soft, descending two-note tone</dd>
        </div>
        <div>
          <dt>Clarify your answer</dt>
          <dd>Two questioning bell notes</dd>
        </div>
        <div>
          <dt>Answer time runs out</dt>
          <dd>Three short, low ticks</dd>
        </div>
        <div>
          <dt>A new question starts</dt>
          <dd>A quiet octave chime</dd>
        </div>
      </dl>
    </>
  );
}
