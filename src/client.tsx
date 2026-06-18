import React from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./app";

const container = document.getElementById("root");
if (container) {
  // The server already rendered the markup; hydrate it so React reuses the
  // existing DOM instead of throwing it away. Initial data comes from the
  // window global injected by ssr.tsx.
  hydrateRoot(container, <App />);
}
