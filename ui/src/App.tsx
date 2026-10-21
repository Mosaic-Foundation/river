// The River UI. One page in M6, the feed at /; anything else is the 404 page. The Following
// page (M9) and sign-in (M8) add routes here.
import { NotFound } from "./components/NotFound";
import { River } from "./River";

export default function App() {
  if (window.location.pathname !== "/") {
    return <NotFound message="This page doesn't exist." homeLink />;
  }
  return <River />;
}
