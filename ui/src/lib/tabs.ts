// The phone's bottom tabs (spec 2, phone paragraph: Feed, Circles, Following, You).
export type Tab = "feed" | "circles" | "following" | "you";

/** What the phone's Circles, Following and You tabs say until those flows exist. */
export const TAB_PLACEHOLDERS: Record<Exclude<Tab, "feed">, { title: string; text: string }> = {
  circles: {
    title: "Circles",
    text: "Making and editing your own circles comes with an account. For now, pick one of this River's circles from the chips on the Feed tab.",
  },
  following: {
    title: "Following",
    text: "Your Following page, with the spaces and streams you follow, comes with an account. This River shows its default follows until then.",
  },
  you: {
    title: "You",
    text: "Sign-up and sign-in are coming soon. Until then, what you mark read stays in this browser only.",
  },
};
