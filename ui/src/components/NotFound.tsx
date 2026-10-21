// The 404 page (check 26): an unknown hostname (the API answers unknown_host), or a path the
// River doesn't have.
import { useEffect } from "react";
import { Brand } from "./Chrome";

export function NotFound({ message, homeLink }: { message: string; homeLink: boolean }) {
  useEffect(() => {
    document.title = "Not found · Mosaic River";
  }, []);
  return (
    <div className="page page-notfound">
      <header className="topbar">
        <Brand link={homeLink} />
      </header>
      <main className="notfound" data-testid="not-found">
        <p className="notfound-code">404</p>
        <h1>{message}</h1>
        {homeLink ? (
          <p>
            <a href="/">Go to the River</a>
          </p>
        ) : (
          <p>Check the address, or visit river.mosaic.social.</p>
        )}
      </main>
    </div>
  );
}
