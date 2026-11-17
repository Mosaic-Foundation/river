// The Civic panel's two placeholder slots (spec F9, 4.7): they name what they will show and the
// data sources they wait on. Real representative, ballot or election data is out of scope for v1
// (spec 5); these make no request and read no item.
import type { ViewPlugin } from "../api.js";

export const representativesPlugin: ViewPlugin = {
  manifest: {
    id: "your-representatives",
    kind: "view",
    version: "1.0.0",
    surfaces: ["river.panel"],
    title: "Your representatives",
    capabilities: [],
  },
  render: () => ({
    type: "placeholder",
    text: "Who represents you at each level, and how to reach them.",
    waitingOn: ["Open States", "Geocodio", "Cicero"],
  }),
};

export const electionsPlugin: ViewPlugin = {
  manifest: {
    id: "elections-and-ballot",
    kind: "view",
    version: "1.0.0",
    surfaces: ["river.panel"],
    title: "Elections and ballot",
    capabilities: [],
  },
  render: () => ({
    type: "placeholder",
    text: "Upcoming elections and what is on your ballot.",
    waitingOn: ["Democracy Works", "Ballotpedia"],
  }),
};

// Advisory voting (added 2026-11-17 for a demo): where a member will tell their representatives
// how they want them to vote on upcoming bills. No data source is chosen yet.
export const advisoryVotingPlugin: ViewPlugin = {
  manifest: {
    id: "advisory-voting",
    kind: "view",
    version: "1.0.0",
    surfaces: ["river.panel"],
    title: "Advisory voting",
    capabilities: [],
  },
  render: () => ({
    type: "placeholder",
    text: "Tell your representatives how to vote on upcoming legislation.",
    waitingOn: [],
  }),
};
