import { useEffect, useState } from "react";

// Placeholder screen until M6 builds the River's shell from the mockups.
export default function App() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { ok?: boolean }) => setStatus(body.ok ? "ok" : "error"))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main>
      <h1>Mosaic River</h1>
      <p data-testid="api-status">API: {status}</p>
    </main>
  );
}
