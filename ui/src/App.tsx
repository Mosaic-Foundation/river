// The River UI: the feed at /, an item in the reader view at /item/{id} (ui-revisions-1 item 1),
// the Following page at /following (M9), Your activity at /activity (ADR-010 §7), Settings →
// Linked accounts at /linked-accounts (fediverse-posting-1 item 1); anything else is
// the 404 page. vercel.json serves
// index.html for every path.
import { ActivityPage } from "./Activity";
import { NotFound } from "./components/NotFound";
import { FollowingPage } from "./Following";
import { LinkedAccountsPage } from "./LinkedAccounts";
import { itemIdFromPath } from "./lib/reader";
import { River } from "./River";

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || itemIdFromPath(path)) return <River />;
  if (path === "/following") return <FollowingPage />;
  if (path === "/activity") return <ActivityPage />;
  if (path === "/linked-accounts") return <LinkedAccountsPage />;
  return <NotFound message="This page doesn't exist." homeLink />;
}
