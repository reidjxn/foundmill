/**
 * A finished task's result as the founder reads it (WP-05 T7): the report's title, its body as Markdown and the pages it
 * drew on. The text is an agent's and may quote web pages, so it is shown as text and never as HTML: raw HTML is
 * skipped, images show their alt text, only http(s) addresses are links (they open in a new tab), and entity mentions
 * render through `EntityLink` (the caller strips any that do not validate). A simulated result says so above the body.
 */
import { FlaskConical } from "lucide-react";
import { Chip } from "../foundation/Chip";
import { Markdown } from "../data/Markdown";

export const TASK_RESULT_SIMULATED = "Simulated: sample data, nothing real was read";

export interface TaskResultSource {
  url: string;
  title: string;
}

export interface TaskResultProps {
  title: string;
  bodyMd: string;
  sources: readonly TaskResultSource[];
  simulated: boolean;
  className?: string;
}

const isWebAddress = (url: string) => /^https?:\/\//i.test(url);

export function TaskResult({ title, bodyMd, sources, simulated, className }: TaskResultProps) {
  return (
    <article className={className} data-task-result data-simulated={simulated ? "true" : "false"}>
      <h3 className="t-body-strong mb-2 text-primary">{title}</h3>
      {simulated ? (
        <p className="mb-3">
          <Chip tone="warn" icon={FlaskConical}>
            {TASK_RESULT_SIMULATED}
          </Chip>
        </p>
      ) : null}
      <Markdown variant="body" images={false} webLinksOnly>
        {bodyMd}
      </Markdown>
      {sources.length > 0 ? (
        <section className="mt-4" aria-label="Sources">
          <p className="t-title mb-1 text-secondary">Sources</p>
          <ul className="my-0 list-disc pl-5 text-small marker:text-secondary">
            {sources.map((s, i) => (
              <li key={`${i}-${s.url}`} className="my-0.5">
                {isWebAddress(s.url) ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="entity-link inline-flex min-h-target items-center">
                    {s.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span>{s.title}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
