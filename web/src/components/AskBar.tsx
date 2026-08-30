import { forwardRef, useEffect, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";

interface AskBarProps {
  prompt?: string;
  context?: string;
  expanded: boolean;
  onExpand: () => void;
  onSubmit: (value: string) => void;
  onNew?: () => void;
}

export const AskBar = forwardRef<HTMLInputElement, AskBarProps>(function AskBar(
  { prompt, context, expanded, onExpand, onSubmit, onNew },
  ref,
) {
  const [value, setValue] = useState("");
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    setValue("");
  }, [prompt]);

  useEffect(() => {
    if (expanded) setHasOpened(true);
  }, [expanded]);

  function submit() {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  }

  return (
    <section className={`ask-region ${expanded ? "is-open" : ""} ${hasOpened ? "has-opened" : ""}`} aria-label="Ask Cedrus">
      <button className="ask-summon" type="button" onClick={onExpand} aria-expanded={expanded}>
        <span>ask cedrus</span>
        <small className="ask-expand-cue" aria-hidden="true">+</small>
        <small className="ask-key-hint" aria-hidden="true">⌘K</small>
      </button>
      <form
        className="ask-form"
        aria-hidden={!expanded}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {context && <span className="ask-context" aria-hidden="true">{context}</span>}
        <input
          ref={ref}
          value={value}
          disabled={!expanded}
          onChange={(event) => setValue(event.target.value)}
          placeholder={prompt ?? "Ask about the plan or make time…"}
          aria-label="Ask Cedrus or enter a planning command"
        />
        {onNew && (
          <button className="ask-new" type="button" onClick={onNew} aria-label="New Cedrus intake" title="New intake">
            <Plus size={14} />
          </button>
        )}
        <button type="submit" aria-label="Send to Cedrus" title="Send">
          <ArrowUp size={15} />
        </button>
      </form>
    </section>
  );
});
