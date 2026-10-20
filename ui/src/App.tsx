import { useEffect, useState } from "react";

// Placeholder screen. The first thread replaces it with the app's real shell.
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
      <h1>App</h1>
      <p data-testid="api-status">API: {status}</p>
    </main>
  );
}
