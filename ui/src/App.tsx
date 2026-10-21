// The River UI: the feed at /, the Following page at /following (M9); anything else is the 404
// page. vercel.json serves index.html for both paths.
import { NotFound } from "./components/NotFound";
import { FollowingPage } from "./Following";
import { River } from "./River";

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <River />;
  if (path === "/following") return <FollowingPage />;
  return <NotFound message="This page doesn't exist." homeLink />;
}
