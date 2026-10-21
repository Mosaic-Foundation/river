// The phone's bottom tabs (spec 2, phone paragraph: Feed, Circles, Following, You).
export type Tab = "feed" | "circles" | "following" | "you";

/** What the phone's Circles and Following tabs say to a visitor (members get the real thing, M9). */
export const TAB_PLACEHOLDERS: Record<"circles" | "following", { title: string; text: string }> = {
  circles: {
    title: "Circles",
    text: "Making and editing your own circles comes with an account. For now, pick one of this River's circles from the chips on the Feed tab.",
  },
  following: {
    title: "Following",
    text: "Following Civic Hubs, fediverse accounts and single streams comes with an account. This River shows its default follows until then.",
  },
};
