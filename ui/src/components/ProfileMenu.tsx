// The profile menu (docs/spec/ui-revisions-9.md item 1): a round button at the right of the top
// bar, a member's initials or a person icon, opening a menu of My information and Following
// (members), Your activity (members, ADR-010 §7), Settings, Sign out and Sign out everywhere (or Sign in for a visitor). My information explains DIDs and shows the member's;
// Settings holds the light/dark switch (item 2). Keyboard and screen readers as the circles menu:
// a menu button, arrow keys, Escape, a click outside, focus back on the button.
import { useEffect, useId, useRef, useState } from "react";
import { SIGN_IN_URL, type Viewer } from "../lib/api";
import { useColorScheme } from "./useColorScheme";
import { initials } from "../lib/format";
import { YouIcon } from "./Icons";
import { InfoDialog } from "./InfoDialog";

type Action = "info" | "settings" | "signout" | "signout-everywhere";
type Item = { key: string; label: string } & ({ href: string } | { action: Action });

/** The light/dark switch (Settings). */
function SchemeSwitch() {
  const [scheme, setScheme] = useColorScheme();
  const labelId = useId();
  const dark = scheme === "dark";
  return (
    <div className="settings-row">
      <span className="settings-label" id={labelId}>
        Dark mode
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={dark}
        aria-labelledby={labelId}
        data-testid="dark-mode-switch"
        onClick={() => setScheme(dark ? "light" : "dark")}
      >
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

/** What a DID is, a Mosaic DID, and the member's (My information). */
function MyInformation({ did }: { did: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h3 className="info-dialog-subtitle">What's a DID?</h3>
      <p>
        A DID (decentralized identifier) is an address for you that no single company owns. It's an open W3C standard:
        it points to a public document with your public keys, so other sites can check that something really came from
        you.
      </p>
      <h3 className="info-dialog-subtitle">Your Mosaic DID</h3>
      <p>
        Mosaic ID created yours when you signed up, as a <code>did:webvh</code> at id.mosaic.social. Its history is
        signed and can be checked by anyone, and it's portable: it can move to another host and stay the same. The River
        knows you by this DID, never by your email address.
      </p>
      {did ? (
        <div className="my-did">
          <code className="my-did-value" data-testid="my-did">
            {did}
          </code>
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(did).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="card-muted">This account has no DID linked yet.</p>
      )}
    </>
  );
}

export function ProfileMenu({
  viewer,
  onSignOut,
  followingHref = "/following",
  activityHref = "/activity",
}: {
  viewer: Viewer | null;
  /** `everywhere`: end every session of this account, on every device. */
  onSignOut: (everywhere?: boolean) => void;
  /** The Following page, keeping the mode (ui-revisions-11 item 1: the bar's link moved here). */
  followingHref?: string;
  /** Your activity (ADR-010 §7), keeping the mode. */
  activityHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dialog, setDialog] = useState<{ which: "info" | "settings"; trigger: HTMLElement } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const name = viewer?.displayName?.trim() || null;

  const items: Item[] = [
    ...(viewer
      ? [
          { key: "info", label: "My information", action: "info" as const },
          { key: "following", label: "Following", href: followingHref },
          { key: "activity", label: "Your activity", href: activityHref },
        ]
      : []),
    { key: "settings", label: "Settings", action: "settings" },
    ...(viewer
      ? [
          { key: "signout", label: "Sign out", action: "signout" as const },
          { key: "signout-everywhere", label: "Sign out everywhere", action: "signout-everywhere" as const },
        ]
      : [{ key: "signin", label: "Sign in", href: SIGN_IN_URL }]),
  ];

  const select = (action: Action) => {
    if (action === "signout" || action === "signout-everywhere") {
      onSignOut(action === "signout-everywhere");
      return;
    }
    // A dialog opened from the menu returns focus to the menu button when it closes.
    setOpen(false);
    if (buttonRef.current) setDialog({ which: action, trigger: buttonRef.current });
  };

  const nodes = () => [...(popupRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const focusItem = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    nodes()[next]?.focus();
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (open) nodes()[active]?.focus();
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A click outside closes it; focus goes back to the button unless the click took it elsewhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
      window.setTimeout(() => {
        const now = document.activeElement as HTMLElement | null;
        if (!now || now === document.body || now.tabIndex < 0) buttonRef.current?.focus();
      }, 0);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="profile-menu">
      <button
        ref={buttonRef}
        type="button"
        className="profile-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={viewer ? "Your profile and settings" : "Settings"}
        data-testid="profile-button"
        onClick={() => {
          if (open) close();
          else {
            setActive(0);
            setOpen(true);
          }
        }}
      >
        {name ? <span className="profile-initials">{initials(name)}</span> : <YouIcon className="profile-icon" />}
      </button>
      {open && (
        <div
          ref={popupRef}
          className="profile-popup"
          data-testid="profile-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !popupRef.current?.contains(next) && next !== buttonRef.current) close(false);
          }}
        >
          <p className="profile-who">{viewer ? (name ?? "Signed in") : "Not signed in"}</p>
          <ul
            className="profile-list"
            role="menu"
            id={menuId}
            aria-label={viewer ? "Your profile and settings" : "Settings"}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") focusItem(active + 1);
              else if (e.key === "ArrowUp") focusItem(active - 1);
              else if (e.key === "Home") focusItem(0);
              else if (e.key === "End") focusItem(items.length - 1);
              else return;
              e.preventDefault();
            }}
          >
            {items.map((item, i) => (
              <li key={item.key} role="none">
                {"href" in item ? (
                  <a
                    role="menuitem"
                    className="profile-item"
                    href={item.href}
                    tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-item"
                    tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onClick={() => select(item.action)}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Rendered only while open, so the DID is in the page only while it's shown. */}
      {dialog?.which === "info" && (
        <InfoDialog trigger={dialog.trigger} title="My information" closeLabel="Done" onClose={() => setDialog(null)} testId="my-information">
          <MyInformation did={viewer?.did ?? null} />
        </InfoDialog>
      )}
      {dialog?.which === "settings" && (
        <InfoDialog trigger={dialog.trigger} title="Settings" closeLabel="Done" onClose={() => setDialog(null)} testId="settings">
          <h3 className="info-dialog-subtitle">Appearance</h3>
          <SchemeSwitch />
          <p className="card-muted">Saved in this browser. Until you choose, the River follows your device's setting.</p>
        </InfoDialog>
      )}
    </div>
  );
}
