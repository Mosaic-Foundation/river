// The river.panel surface (spec F9, 4.7; docs/design/mockups/civic-desktop.png): what the mode's
// plugins returned for the current view, in the mode's order. Plugins return data, never markup;
// each output type has its own component here, drawn with the theme's tokens. Desktop: a column
// to the right of the feed. Phone: above the feed.
import type { DateEntry, SurfaceOutput } from "../lib/api";
import { eventDate } from "../lib/format";
import { dateEntryDetail, pluginTag, waitingOnText } from "../lib/modes";

function DateRow({ entry }: { entry: DateEntry }) {
  const date = eventDate(entry.date);
  if (!date) return null;
  return (
    <li className="plugin-date" data-testid="coming-up-entry">
      <span className="card-event-date" aria-hidden="true">
        <span className="card-event-month">{date.month}</span>
        <span className="card-event-day">{date.day}</span>
      </span>
      <span className="plugin-date-detail">
        {entry.url ? (
          <a className="plugin-date-title" href={entry.url} target="_blank" rel="noopener noreferrer">
            {entry.title}
          </a>
        ) : (
          <span className="plugin-date-title">{entry.title}</span>
        )}
        <span className="plugin-date-meta">
          <time dateTime={date.dateTime}>{date.label}</time>
          <span>{dateEntryDetail(entry)}</span>
        </span>
      </span>
    </li>
  );
}

function PluginBlock({ plugin }: { plugin: SurfaceOutput }) {
  const { output } = plugin;
  const headingId = `plugin-${plugin.id}`;
  return (
    <section
      className={output.type === "placeholder" ? "plugin plugin-slot" : "plugin"}
      aria-labelledby={headingId}
      data-testid={`plugin-${plugin.id}`}
    >
      <div className="plugin-head">
        <h2 className="plugin-title" id={headingId}>
          {plugin.title}
        </h2>
        <span className="plugin-tag">{pluginTag(output)}</span>
      </div>
      {output.type === "dates" && (
        <>
          <p className="plugin-intro">{output.intro}</p>
          {output.entries.length > 0 && (
            <ol className="plugin-dates" aria-label={`${plugin.title}, soonest first`}>
              {output.entries.map((entry) => (
                <DateRow key={`${entry.itemId}-${entry.what}`} entry={entry} />
              ))}
            </ol>
          )}
        </>
      )}
      {output.type === "placeholder" && (
        <>
          <p className="plugin-text">{output.text}</p>
          <p className="plugin-intro">{waitingOnText(output.waitingOn)}</p>
        </>
      )}
    </section>
  );
}

export function PluginPanel({ plugins, label }: { plugins: SurfaceOutput[]; label: string }) {
  if (plugins.length === 0) return null;
  return (
    <aside className="plugin-panel" aria-label={label} data-testid="plugin-panel">
      {plugins.map((plugin) => (
        <PluginBlock key={plugin.id} plugin={plugin} />
      ))}
    </aside>
  );
}
